import { afterEach, describe, expect, it, vi } from "vitest";
import { blockedRequestMessage } from "./networkGuard";

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

  // Neither Node nor jsdom implements it, which is why the guard has nothing
  // to wrap. If a jsdom upgrade adds one, this goes red and the guard's
  // header comment — which relies on its absence — must be revisited.
  it("has no navigator.sendBeacon to guard", () => {
    expect(typeof (navigator as { sendBeacon?: unknown }).sendBeacon).toBe("undefined");
  });
});
