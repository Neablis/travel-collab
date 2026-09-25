import type { z } from "zod";

// KI-2026-09-05-q / F-E04. The access half of a route's preamble has one seam
// (`requireTripAccess`); body reading had none, and five routes awaited
// `request.json()` bare. That call REJECTS on a body that is not JSON, so the
// rejection escaped the handler and Next answered 500 — a client error filed
// in Sentry as a server fault — while the same routes answered 400 to JSON the
// schema refused. This is the one place both failures become the same 400.
//
// The result has the `"error" in x` shape `requireTripAccess` returns, so a
// route's preamble reads as two identical steps:
//
//   const g = await guard(tripId, "editor");
//   if ("error" in g) return g.error;
//   const body = await readBody(req, CreatePageInput, "invalid-page");
//   if ("error" in body) return body.error;
//
// Not used by `/ask`: that pipeline caps the body on BYTES before parsing it
// (`capRawBody` in `server/assistant/admission.ts`) and its 400 names the rule
// broken. Not used by `/api/v1`, which answers in its own error envelope
// (`server/public-api`) — though it shares `readCapped` below.
//
// A route that stores what it is sent passes `maxBytes` (KI-2026-09-05-f item
// 1: the notebook routes). The body is then read as text in chunks and refused
// with a 413 the moment it passes the ceiling, before a byte of it is parsed.

// A sentinel rather than `null`: `null` is valid JSON, and a schema that
// accepts it must still be handed it.
const INVALID_JSON = Symbol("invalid-json");

/** What `readCapped` returns instead of a body when the ceiling is passed. */
export const TOO_LARGE = Symbol("body over its byte ceiling");

/** A body read that failed (already a 400 or 413), or the parsed body. */
export type ReadBodyResult<T> = { error: Response } | { data: T };

/**
 * The request's JSON body parsed against `schema`. A body that is not JSON and
 * a body the schema refuses both come back as a 400 carrying `invalid` as its
 * `error` — never as a rejected promise, which is what a route turns into a 500.
 * With `maxBytes`, a body larger than that is a 413 naming the limit.
 */
export async function readBody<Schema extends z.ZodTypeAny>(
  request: Request,
  schema: Schema,
  invalid = "malformed request",
  options: { maxBytes?: number } = {},
): Promise<ReadBodyResult<z.infer<Schema>>> {
  const raw =
    options.maxBytes === undefined
      ? await request.json().catch(() => INVALID_JSON)
      : await readJsonCapped(request, options.maxBytes);
  if (raw === TOO_LARGE) {
    const limit = options.maxBytes!.toLocaleString("en-US");
    return { error: Response.json({ error: `The request body must be ${limit} bytes or fewer.` }, { status: 413 }) };
  }
  const parsed = raw === INVALID_JSON ? null : schema.safeParse(raw);
  if (!parsed?.success) return { error: Response.json({ error: invalid }, { status: 400 }) };
  return { data: parsed.data as z.infer<Schema> };
}

/**
 * `request.json()` with a byte ceiling. `Content-Length` is a cheap early out
 * and never the answer — it is a claim, and a chunked body may not send one.
 */
async function readJsonCapped(request: Request, max: number): Promise<unknown> {
  const claimed = Number(request.headers.get("content-length"));
  if (Number.isFinite(claimed) && claimed > max) return TOO_LARGE;
  const text = await readCapped(request, max);
  if (text === TOO_LARGE) return TOO_LARGE;
  if (text === undefined) return INVALID_JSON;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

/**
 * The request body as text, refusing as soon as it passes `max` bytes.
 *
 * **Counted while reading and cancelled on the way past**, rather than measured
 * after the fact: a body already known to be over the ceiling should not be
 * held in full first. `Content-Length` is checked before this (it is a cheap
 * early out) and is never trusted as the answer — it is a claim, and a chunked
 * upload may not send one at all.
 *
 * Decoded with a streaming `TextDecoder`, because a multi-byte character can
 * straddle two chunks and decoding each chunk alone would corrupt it.
 */
export async function readCapped(request: Request, max: number): Promise<string | undefined | typeof TOO_LARGE> {
  const stream = request.body;
  if (stream === null) return undefined;
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let seen = 0;
  let out = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen > max) {
        await reader.cancel().catch(() => undefined);
        return TOO_LARGE;
      }
      out += decoder.decode(value, { stream: true });
    }
  } catch {
    return undefined;
  }
  return out + decoder.decode();
}
