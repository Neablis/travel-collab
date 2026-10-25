import { describe, expect, it, vi } from "vitest";
import { fetchRemoteImage, type Fetcher } from "./fetchImage";
import { RemoteImageRefused, type Resolve } from "./guard";

// The guarded fetcher (ADR-081 item 4) against a fake `fetch` and a fake
// resolver: no test here reaches the network or DNS. Each refusal below is a
// way a cover URL could serve script, exhaust memory, or reach inside.

const PUBLIC = "93.184.216.34";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A resolver that answers the private address for `inside.example.com` and the public one for everything else. */
const resolve: Resolve = async (host) => [{ address: host === "inside.example.com" ? "10.0.0.7" : PUBLIC, family: 4 }];

const image = (body: BodyInit = PNG, contentType = "image/png") =>
  new Response(body, { status: 200, headers: { "content-type": contentType } });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

/** A fake `fetch` answering each URL from `routes`, recording what it was asked. */
function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn<Fetcher>(async (url) => {
    const answer = routes[url.href];
    if (answer === undefined) throw new Error(`unexpected fetch of ${url.href}`);
    return answer();
  });
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(RemoteImageRefused);
  return (error as RemoteImageRefused).reason;
}

/** A body of `chunks` chunks of `size` bytes each, with no `Content-Length` to trust. */
function streamOf(chunks: number, size: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent === chunks) return controller.close();
      sent += 1;
      controller.enqueue(new Uint8Array(size));
    },
  });
}

describe("fetchRemoteImage", () => {
  it("answers the image's bytes and type, asking upstream with nothing of the viewer's", async () => {
    const fetch = fakeFetch({ "https://cdn.example.com/a.png": () => image() });
    const got = await fetchRemoteImage("https://cdn.example.com/a.png", {}, { fetch, resolve });
    expect(got).toEqual({ contentType: "image/png", bytes: PNG });
    const [, init] = fetch.mock.calls[0]!;
    expect(init.redirect).toBe("manual");
    // No cookie, no referrer, no authorization: only what the fetcher itself sets.
    expect(Object.keys(init.headers).map((name) => name.toLowerCase()).sort()).toEqual(["accept", "user-agent"]);
  });

  it("refuses a URL that is not https", async () => {
    const fetch = fakeFetch({});
    expect(await refusal(fetchRemoteImage("http://cdn.example.com/a.png", {}, { fetch, resolve }))).toBe("not-https");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a host that resolves to a private address, before fetching it", async () => {
    const fetch = fakeFetch({});
    expect(await refusal(fetchRemoteImage("https://inside.example.com/a.png", {}, { fetch, resolve }))).toBe("private-address");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a response that is not an image", async () => {
    const fetch = fakeFetch({ "https://cdn.example.com/page": () => image("<html></html>", "text/html; charset=utf-8") });
    expect(await refusal(fetchRemoteImage("https://cdn.example.com/page", {}, { fetch, resolve }))).toBe("not-an-image");
  });

  it("refuses an SVG, which can carry script", async () => {
    const fetch = fakeFetch({ "https://cdn.example.com/a.svg": () => image("<svg/>", "Image/SVG+XML") });
    expect(await refusal(fetchRemoteImage("https://cdn.example.com/a.svg", {}, { fetch, resolve }))).toBe("svg");
  });

  it("refuses an image that passes the cap while streaming, whatever Content-Length says", async () => {
    const fetch = fakeFetch({
      "https://cdn.example.com/big.png": () =>
        new Response(streamOf(5, 1024), { status: 200, headers: { "content-type": "image/png", "content-length": "10" } }),
    });
    const url = "https://cdn.example.com/big.png";
    expect(await refusal(fetchRemoteImage(url, { maxBytes: 4096 }, { fetch, resolve }))).toBe("too-large");
    await expect(fetchRemoteImage(url, { maxBytes: 5120 }, { fetch, resolve })).resolves.toMatchObject({
      bytes: expect.objectContaining({ byteLength: 5120 }),
    });
  });

  it("follows up to three redirects and refuses the fourth", async () => {
    const hops = {
      "https://cdn.example.com/0": () => redirect("/1"),
      "https://cdn.example.com/1": () => redirect("https://cdn.example.com/2"),
      "https://cdn.example.com/2": () => redirect("/3"),
      "https://cdn.example.com/3": () => image(),
    };
    await expect(fetchRemoteImage("https://cdn.example.com/0", {}, { fetch: fakeFetch(hops), resolve })).resolves.toMatchObject({
      contentType: "image/png",
    });
    const fourth = { ...hops, "https://cdn.example.com/3": () => redirect("/4"), "https://cdn.example.com/4": () => image() };
    expect(await refusal(fetchRemoteImage("https://cdn.example.com/0", {}, { fetch: fakeFetch(fourth), resolve }))).toBe(
      "too-many-redirects",
    );
  });

  it("re-checks every hop: a redirect into a private address is refused before it is fetched", async () => {
    const fetch = fakeFetch({ "https://cdn.example.com/a.png": () => redirect("https://inside.example.com/admin") });
    expect(await refusal(fetchRemoteImage("https://cdn.example.com/a.png", {}, { fetch, resolve }))).toBe("private-address");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("re-checks every hop: a redirect down to http is refused", async () => {
    const fetch = fakeFetch({ "https://cdn.example.com/a.png": () => redirect("http://cdn.example.com/a.png") });
    expect(await refusal(fetchRemoteImage("https://cdn.example.com/a.png", {}, { fetch, resolve }))).toBe("not-https");
  });

  it("refuses an upstream error status", async () => {
    const fetch = fakeFetch({ "https://cdn.example.com/gone.png": () => new Response("gone", { status: 404 }) });
    expect(await refusal(fetchRemoteImage("https://cdn.example.com/gone.png", {}, { fetch, resolve }))).toBe("upstream-status");
  });

  it("answers a timeout as its own reason", async () => {
    const fetch = vi.fn<Fetcher>(
      (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    expect(await refusal(fetchRemoteImage("https://cdn.example.com/slow.png", { timeoutMs: 5 }, { fetch, resolve }))).toBe(
      "timeout",
    );
  });
});
