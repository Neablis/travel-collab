import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { http as mswHttp, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { blockedRequestMessage, connectTarget, guardFetch } from "./networkGuard";

afterEach(() => {
  vi.restoreAllMocks();
});

// The first case runs against the GLOBAL fetch on purpose: what it proves is
// that `vitest.setup.ts` installed the guard, not that the wrapper works in
// isolation. `.invalid` is reserved (RFC 2606) and never resolves, so if the
// guard is missing this fails on a DNS error rather than by reaching anyone.
describe("the test network guard", () => {
  it("rejects a fetch to a third-party host, naming the URL and the fix", async () => {
    const url = "https://third-party.invalid/v1/search?q=Colosseum";
    await expect(fetch(url)).rejects.toThrow(blockedRequestMessage(url));
  });

  it("names a Request's URL too, not only a string's", async () => {
    const url = "https://third-party.invalid/v1/charges";
    await expect(fetch(new Request(url, { method: "POST" }))).rejects.toThrow(blockedRequestMessage(url));
  });

  it("hands this machine's addresses and relative URLs to the real fetch", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const guarded = guardFetch(inner as unknown as typeof fetch);
    for (const url of ["http://localhost:3001/api/geocode", "http://127.0.0.1:5432/", "http://[::1]:3001/", "/api/geocode?q=x"]) {
      await expect(guarded(url)).resolves.toBeInstanceOf(Response);
    }
    expect(inner).toHaveBeenCalledTimes(4);
  });

  // `0.0.0.0` is what a dev server bound to every interface prints as its own
  // address, and `*.localhost` resolves to loopback by RFC 6761 (browsers and
  // Node's resolver both honour it) — so a test URL built from either is this
  // machine, and blocking it would send someone hunting for a third party
  // that is not there. The suffix is matched on a dot boundary: a host that
  // merely ENDS in the letters is someone else's.
  it("treats 0.0.0.0 and any *.localhost host as this machine, and nothing that only looks like one", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const guarded = guardFetch(inner as unknown as typeof fetch);
    for (const url of ["http://0.0.0.0:3001/api/health", "http://app.localhost:3000/", "http://a.b.localhost/"]) {
      await expect(guarded(url)).resolves.toBeInstanceOf(Response);
    }
    expect(inner).toHaveBeenCalledTimes(3);
    await expect(guarded("https://notlocalhost/")).rejects.toThrow(/Blocked network request/);
    await expect(guarded("https://localhost.example.com/")).rejects.toThrow(/Blocked network request/);
  });

  it("does not hand a third-party request to the real fetch at all", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const guarded = guardFetch(inner as unknown as typeof fetch);
    await expect(guarded(new URL("https://us1.locationiq.com/v1/search"))).rejects.toThrow(/Blocked network request/);
    expect(inner).not.toHaveBeenCalled();
  });
});

// KI-2026-09-24-u: everything that is not `fetch` is refused where it all ends
// up, `net.Socket#connect`. Run against the INSTALLED guard, like the first
// fetch case above, so what is proved is that the setup file patched it.
describe("the test network guard, beneath fetch", () => {
  /** A local HTTP server that counts what reaches it. */
  async function countingServer(): Promise<{ port: number; hits: () => number; close: () => void }> {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits++;
      res.end("reached");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { port: (server.address() as AddressInfo).port, hits: () => hits, close: () => server.close() };
  }

  /** The body, or the error message, of one GET made with `transport.get`. */
  function get(options: http.RequestOptions | string, transport: typeof http | typeof https = http): Promise<string> {
    return new Promise((resolve) => {
      transport
        .get(options, (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve(body));
        })
        .on("error", (error) => resolve(`error: ${error.message}`));
    });
  }

  // The name is a third party's, but `lookup` resolves it to a server on this
  // box — so without the guard the request is ANSWERED, measurably ("reached",
  // one hit), and with it the connect never happens. No packet leaves either
  // way; that is the point of pointing the name at loopback.
  it("refuses an http.get to a third-party name before it connects, even when the name would resolve here", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const server = await countingServer();
    const lookup = ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) =>
      options.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4)) as never;
    try {
      const result = await get({ host: "third-party.invalid", port: server.port, path: "/v1/search", lookup });
      expect(result).toBe(`error: ${blockedRequestMessage(`third-party.invalid:${server.port}`)}`);
      expect(server.hits()).toBe(0);
    } finally {
      server.close();
    }
  });

  it("refuses https.request and https.get the same way, and says so on the console", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = blockedRequestMessage("third-party.invalid:443");
    const viaRequest = await new Promise<string>((resolve) => {
      https
        .request("https://third-party.invalid/v1/charges", { method: "POST" })
        .on("error", (error) => resolve(error.message))
        .end();
    });
    expect(viaRequest).toBe(refused);
    expect(await get("https://third-party.invalid/v1/search", https)).toBe(`error: ${refused}`);
    expect(consoleError).toHaveBeenCalledWith(refused);
  });

  it("refuses a WebSocket to a third-party host", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const socket = new WebSocket("wss://third-party.invalid/realtime");
    const code = await new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code)));
    expect(code).toBe(1006);
    expect(consoleError).toHaveBeenCalledWith(blockedRequestMessage("third-party.invalid:443"));
  });

  it("still lets this machine through: an http.get to a local server is answered", async () => {
    const server = await countingServer();
    try {
      expect(await get(`http://127.0.0.1:${server.port}/`)).toBe("reached");
      expect(await get(`http://localhost:${server.port}/`)).toBe("reached");
      expect(server.hits()).toBe(2);
    } finally {
      server.close();
    }
  });

  // MSW's ClientRequestInterceptor answers a handled request on a mock socket
  // that never calls `net.Socket#connect`, so the guard must not see it; an
  // unhandled one passes through to the real agent and must be refused.
  describe("with MSW listening", () => {
    const server = setupServer(
      mswHttp.get("https://api.third-party.invalid/v1/search", () => HttpResponse.json({ stubbed: true })),
    );
    beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
    afterAll(() => server.close());

    it("answers a handled https.get from the stub, and refuses an unhandled one", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await get("https://api.third-party.invalid/v1/search", https)).toBe('{"stubbed":true}');
      expect(await get("https://api.third-party.invalid/v1/unhandled", https)).toBe(
        `error: ${blockedRequestMessage("api.third-party.invalid:443")}`,
      );
    });
  });

  it("reads the host out of every connect overload, and leaves pipes alone", () => {
    expect(connectTarget([{ host: "api.stripe.com", port: 443 }])).toEqual({ host: "api.stripe.com", port: 443 });
    expect(connectTarget([[{ host: "api.stripe.com", port: 443 }, null]])).toEqual({ host: "api.stripe.com", port: 443 });
    expect(connectTarget([443, "api.stripe.com"])).toEqual({ host: "api.stripe.com", port: 443 });
    expect(connectTarget(["5432"])).toEqual({ host: "localhost", port: 5432 });
    expect(connectTarget([{ port: 5432 }])).toEqual({ host: "localhost", port: 5432 });
    expect(connectTarget([{ host: "api.stripe.com", port: 443, path: null }])).toEqual({ host: "api.stripe.com", port: 443 });
    expect(connectTarget([{ path: "/var/run/postgresql/.s.PGSQL.5432" }])).toBeUndefined();
    expect(connectTarget(["/var/run/postgresql/.s.PGSQL.5432"])).toBeUndefined();
  });
});
