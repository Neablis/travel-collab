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
