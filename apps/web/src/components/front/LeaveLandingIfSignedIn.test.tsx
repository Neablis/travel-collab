import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNED_IN_HINT_COOKIE } from "@/lib/sessionHint";
import { LandingScreen } from "./LandingScreen";
import { LeaveLandingIfSignedIn } from "./LeaveLandingIfSignedIn";

// A client navigation to `/` (the 404's *Caesura home*, Back from `/signin`)
// runs no head script, so the landing itself must send a hinted visitor on.
const originalLocation = window.location;
let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replace = vi.fn();
  // jsdom's `location.replace` is not configurable, so the object is swapped.
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace } });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  document.cookie = `${SIGNED_IN_HINT_COOKIE}=; Path=/; Max-Age=0`;
});

describe("LeaveLandingIfSignedIn", () => {
  it("replaces the landing with Home when the hint is present", () => {
    document.cookie = `${SIGNED_IN_HINT_COOKIE}=1; Path=/`;
    render(<LeaveLandingIfSignedIn />);
    expect(replace).toHaveBeenCalledWith("/home");
  });

  it("stays without the hint", () => {
    document.cookie = "theme=dark; Path=/";
    render(<LeaveLandingIfSignedIn />);
    expect(replace).not.toHaveBeenCalled();
  });

  // A back-forward-cache restore re-runs no effect; only `pageshow` fires,
  // with `persisted`, and the hint is read at that moment.
  function restore(persisted: boolean) {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));
  }

  it("replaces a landing restored from the back-forward cache once the hint is present", () => {
    render(<LeaveLandingIfSignedIn />);
    expect(replace).not.toHaveBeenCalled();
    document.cookie = `${SIGNED_IN_HINT_COOKIE}=1; Path=/`;
    restore(true);
    expect(replace).toHaveBeenCalledWith("/home");
  });

  it("ignores a pageshow that is not a restore", () => {
    render(<LeaveLandingIfSignedIn />);
    document.cookie = `${SIGNED_IN_HINT_COOKIE}=1; Path=/`;
    restore(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it("is mounted by the landing", () => {
    document.cookie = `${SIGNED_IN_HINT_COOKIE}=1; Path=/`;
    render(<LandingScreen />);
    expect(replace).toHaveBeenCalledWith("/home");
  });
});

// On a full load of `/` the head script has already replaced the page, so the
// first mount must not replace it again (that cancels the request and renders
// Home twice). jsdom has no navigation entries, so the entry is stubbed, and
// each test imports a fresh module because "first mount" is module state.
describe("LeaveLandingIfSignedIn in a document loaded at a given URL", () => {
  async function loadedAt(url: string) {
    Object.defineProperty(performance, "getEntriesByType", {
      configurable: true,
      value: (type: string) => (type === "navigation" ? [{ name: url }] : []),
    });
    vi.resetModules();
    return (await import("./LeaveLandingIfSignedIn")).LeaveLandingIfSignedIn;
  }

  afterEach(() => {
    delete (performance as { getEntriesByType?: unknown }).getEntriesByType;
  });

  it("leaves the first mount in a document loaded at / to the head script", async () => {
    const Leave = await loadedAt("http://localhost:3000/");
    document.cookie = `${SIGNED_IN_HINT_COOKIE}=1; Path=/`;
    render(<Leave />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves on a later mount in that document, as on Back to /", async () => {
    const Leave = await loadedAt("http://localhost:3000/");
    document.cookie = `${SIGNED_IN_HINT_COOKIE}=1; Path=/`;
    render(<Leave />);
    cleanup();
    render(<Leave />);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/home");
  });

  it("leaves on the first mount in a document loaded elsewhere, as on a client navigation from /signin", async () => {
    const Leave = await loadedAt("http://localhost:3000/signin");
    document.cookie = `${SIGNED_IN_HINT_COOKIE}=1; Path=/`;
    render(<Leave />);
    expect(replace).toHaveBeenCalledWith("/home");
  });

  it("still leaves on a back-forward-cache restore of the first mount", async () => {
    const Leave = await loadedAt("http://localhost:3000/");
    document.cookie = `${SIGNED_IN_HINT_COOKIE}=1; Path=/`;
    render(<Leave />);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(replace).toHaveBeenCalledWith("/home");
  });
});
