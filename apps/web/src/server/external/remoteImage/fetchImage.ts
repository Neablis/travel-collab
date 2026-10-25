import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { assertPublicAddress, guardedLookup, RemoteImageRefused, resolveHost, type Resolve } from "./guard";

// The one fetcher for a cover URL (ADR-081 item 4): setting a cover runs it
// once, and the proxy runs it on every CDN miss. Everything it refuses throws
// `RemoteImageRefused` with a reason, and nothing else is thrown for a bad URL.

/** What one hop asks for. Only these headers go upstream: nothing of the viewer's. */
export type FetchInit = { signal: AbortSignal; redirect: "manual"; headers: Record<string, string> };
/** One HTTP GET that does not follow redirects. Injected, so no test reaches the network. */
export type Fetcher = (url: URL, init: FetchInit) => Promise<Response>;

export type RemoteImageLimits = { maxBytes: number; maxRedirects: number; timeoutMs: number };
export const REMOTE_IMAGE_LIMITS: RemoteImageLimits = { maxBytes: 10 * 1024 * 1024, maxRedirects: 3, timeoutMs: 8_000 };

/**
 * The raster types a cover may be, each spelled as we serve it. The proxy
 * sends this string, never upstream's header: a browser reads
 * `image/png,text/html` as HTML, and `image/*+xml` as a document that can
 * carry script, so a type is taken only when its whole media type is one of
 * these.
 */
const RASTER_TYPES = {
  "image/jpeg": "image/jpeg",
  // Not a registered type, but servers send it and every browser decodes it as JPEG.
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
  "image/avif": "image/avif",
} as const;
export type RasterImageType = (typeof RASTER_TYPES)[keyof typeof RASTER_TYPES];

export type RemoteImage = { contentType: RasterImageType; bytes: Uint8Array<ArrayBuffer> };

/** The raster type a `Content-Type` header names, by our spelling, or null for anything else. */
function rasterType(header: string): RasterImageType | null {
  const essence = header.split(";")[0]!.trim().toLowerCase();
  return Object.hasOwn(RASTER_TYPES, essence) ? RASTER_TYPES[essence as keyof typeof RASTER_TYPES] : null;
}

const offline = () => process.env.EXTERNAL_DATA_OFFLINE === "true";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * GET over `node:https`, connecting through `guardedLookup`, so the address
 * the socket connects to is the one the guard checked, while `Host` and SNI
 * stay the URL's name. Without it, the guard's own resolve and the socket's
 * would be two DNS answers, and a rebinding server gives a public one first.
 */
export function guardedHttpsFetcher(resolve: Resolve = resolveHost): Fetcher {
  return (url, init) =>
    new Promise((done, fail) => {
      const request = httpsRequest(
        url,
        { method: "GET", headers: init.headers, signal: init.signal, lookup: guardedLookup(resolve), agent: false },
        (response) => {
          const headers = new Headers();
          for (const name of ["content-type", "content-length", "location"]) {
            const value = response.headers[name];
            if (typeof value === "string") headers.set(name, value);
          }
          const status = response.statusCode ?? 0;
          // Outside what a `Response` can hold; refused as an upstream status.
          if (status < 200 || status > 599) {
            response.destroy();
            return fail(new RemoteImageRefused("upstream-status", String(status)));
          }
          const empty = status === 204 || status === 205 || status === 304;
          if (empty) response.resume();
          const body = empty ? null : (Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>);
          done(new Response(body, { status, headers }));
        },
      );
      request.on("error", fail);
      request.end();
    });
}

/** The refusal inside an error a socket or a stream wrapped it in, if there is one. */
function refusalIn(error: unknown): RemoteImageRefused | null {
  if (error instanceof RemoteImageRefused) return error;
  if (!(error instanceof Error)) return null;
  const nested = [error.cause, ...(error instanceof AggregateError ? error.errors : [])];
  for (const inner of nested) {
    const found = refusalIn(inner);
    if (found !== null) return found;
  }
  return null;
}

function failure(error: unknown, signal: AbortSignal): RemoteImageRefused {
  return refusalIn(error) ?? new RemoteImageRefused(signal.aborted ? "timeout" : "unreachable", String(error));
}

function parsed(href: string, base?: URL): URL {
  try {
    return new URL(href, base);
  } catch {
    throw new RemoteImageRefused("invalid-url");
  }
}

/** The body, refused once it passes `maxBytes`, counted as it arrives rather than taken from `Content-Length`. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
    await response.body?.cancel();
    throw new RemoteImageRefused("too-large");
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RemoteImageRefused("too-large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetch the image at `url`, or throw `RemoteImageRefused`. https only, on the
 * default port; every hop's address is checked before it is fetched, and
 * redirects are followed by hand, at most `maxRedirects`. The answer must be
 * one of `RASTER_TYPES` (never SVG, which can carry script) within
 * `maxBytes`, all within `timeoutMs`. Buffered, so a refusal is never half a response.
 */
export async function fetchRemoteImage(
  url: string,
  limits: Partial<RemoteImageLimits> = {},
  deps: { fetch?: Fetcher; resolve?: Resolve } = {},
): Promise<RemoteImage> {
  // Like every `external/*` source, no network while external data is
  // offline (the e2e server): a URL cover there shows as the no-cover state.
  if (offline()) throw new RemoteImageRefused("offline");
  const { maxBytes, maxRedirects, timeoutMs } = { ...REMOTE_IMAGE_LIMITS, ...limits };
  const resolve = deps.resolve ?? resolveHost;
  const fetch = deps.fetch ?? guardedHttpsFetcher(resolve);
  const signal = AbortSignal.timeout(timeoutMs);
  let current = parsed(url);
  for (let hop = 0; ; hop += 1) {
    if (current.protocol !== "https:") throw new RemoteImageRefused("not-https");
    // A port is a way to reach a service that is not a web server, so only
    // the default one; and credentials in a URL are never ours to send.
    if (current.port !== "" || current.username !== "" || current.password !== "") {
      throw new RemoteImageRefused("invalid-url");
    }
    await assertPublicAddress(current.hostname, resolve);
    let response: Response;
    try {
      response = await fetch(current, {
        signal,
        redirect: "manual",
        headers: { accept: "image/*", "user-agent": "Caesura-CoverImage/1" },
      });
    } catch (error) {
      throw failure(error, signal);
    }
    if (REDIRECTS.has(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (location === null) throw new RemoteImageRefused("upstream-status", String(response.status));
      if (hop >= maxRedirects) throw new RemoteImageRefused("too-many-redirects");
      current = parsed(location, current);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new RemoteImageRefused("upstream-status", String(response.status));
    }
    const header = response.headers.get("content-type") ?? "";
    const contentType = rasterType(header);
    if (contentType === null) {
      await response.body?.cancel();
      // SVG keeps its own reason, so the editor is told why a vector is refused.
      throw new RemoteImageRefused(/svg/i.test(header) ? "svg" : "not-an-image", header);
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readCapped(response, maxBytes);
    } catch (error) {
      throw failure(error, signal);
    }
    if (bytes.byteLength === 0) throw new RemoteImageRefused("not-an-image", "empty body");
    return { contentType, bytes };
  }
}
