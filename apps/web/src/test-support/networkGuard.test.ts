import { describe, expect, it, vi } from "vitest";
import { blockedRequestMessage, guardFetch } from "./networkGuard";

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
