import { afterEach, describe, expect, it, vi } from "vitest";
import { blockedRequestMessage, ownOriginRequestMessage, refuseOwnOrigin, takeRefusedOwnOrigin } from "./networkGuard";

afterEach(() => {
  vi.restoreAllMocks();
});

// KI-2026-09-24-u, the browser half: jsdom's `XMLHttpRequest` and `WebSocket`
// are built on Node's sockets, so the guard that `networkGuard.test.ts` proves
// in the node project has to hold here too. Neither API hands the page an
// error message — XHR fires a bare `error`, WebSocket a 1006 close — so the
// guard's console line is the observable that names the reason.
describe("the test network guard, in jsdom", () => {
  it("refuses an XMLHttpRequest to a third-party host", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://third-party.invalid/v1/search");
    const outcome = await new Promise<string>((resolve) => {
      xhr.addEventListener("error", () => resolve("error"));
      xhr.addEventListener("load", () => resolve(`load ${xhr.status}`));
      xhr.send();
    });
    expect(outcome).toBe("error");
    expect(consoleError).toHaveBeenCalledWith(blockedRequestMessage("third-party.invalid:443"));
  });

  it("refuses a WebSocket to a third-party host", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const socket = new WebSocket("wss://third-party.invalid/realtime");
    const code = await new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code)));
    expect(code).toBe(1006);
    expect(consoleError).toHaveBeenCalledWith(blockedRequestMessage("third-party.invalid:443"));
  });

  // KI-2026-10-28-d: an `apiClient` reader a unit test forgot to mock sends a
  // real request to the page's own origin, which has no server here. The
  // setup file installs the refusal and fails the test with what it recorded;
  // this drains the record itself, so it is the one test that may send one.
  it("refuses a fetch to the page's own origin, and records it for the setup to fail the test on", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const url = new URL("/api/trips/x/suggestions", location.origin).href;
    await expect(fetch(url)).rejects.toThrow(ownOriginRequestMessage(url));
    expect(takeRefusedOwnOrigin()).toEqual([
      { url, sentDuring: expect.stringContaining("refuses a fetch to the page's own origin") },
    ]);
    expect(consoleError).toHaveBeenCalledWith(ownOriginRequestMessage(url));
  });

  // A relative URL never leaves the process (Node's fetch rejects it at once),
  // and another local origin is the lane-wide guard's business.
  it("hands a relative URL and any other origin to the fetch beneath", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const guarded = refuseOwnOrigin(inner as unknown as typeof fetch);
    await guarded("/api/trips/x/suggestions");
    await guarded("http://127.0.0.1:9/elsewhere");
    expect(inner).toHaveBeenCalledTimes(2);
    expect(takeRefusedOwnOrigin()).toEqual([]);
  });

  // Neither Node nor jsdom implements it, which is why the guard has nothing
  // to wrap. If a jsdom upgrade adds one, this goes red and the guard's
  // header comment — which relies on its absence — must be revisited.
  it("has no navigator.sendBeacon to guard", () => {
    expect(typeof (navigator as { sendBeacon?: unknown }).sendBeacon).toBe("undefined");
  });
});
