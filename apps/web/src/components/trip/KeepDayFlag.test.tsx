import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedStop } from "@tc/contracts";

const createSavedDayMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  createSavedDay: (...args: unknown[]) => createSavedDayMock(...args),
}));

import { KeepDayFlag } from "./KeepDayFlag";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const dayId = "11111111-1111-4111-8111-111111111111";

const stops: SavedStop[] = [
  {
    title: "Fushimi Inari",
    timeWindow: { start: "09:00", end: "11:00" },
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
  },
];

function renderFlag(overrides: { stops?: SavedStop[] } = {}) {
  render(
    <KeepDayFlag
      dayIndex={0}
      accent="brand"
      tripId={tripId}
      dayId={dayId}
      tripName="Kyoto"
      stops={overrides.stops ?? stops}
    />,
  );
}

afterEach(cleanup);
beforeEach(() => {
  createSavedDayMock.mockReset().mockResolvedValue({
    ok: true,
    value: { savedDayId: "s1", name: "Day 1 of Kyoto" },
  });
});

// Real as of M11 link 6. TimelineLens used to wrap this in
// <Preview id="keep-day-flag">, which shielded the click; the onClick was
// already wired, what was missing was somewhere to save to.
describe("KeepDayFlag", () => {
  it("opens the keep dialog", async () => {
    renderFlag();
    await userEvent.click(screen.getByRole("button", { name: "Keep day 1" }));
    expect(await screen.findByRole("heading", { name: "Keep this day" })).toBeTruthy();
  });

  // Disabled, not hidden: a row that loses a control as its last stop is
  // removed is worse than one whose control greys out.
  it("is disabled on an empty day, and says why", () => {
    renderFlag({ stops: [] });
    const flag = screen.getByRole("button", { name: "Keep day 1" });
    expect(flag.hasAttribute("disabled")).toBe(true);
    expect(flag.getAttribute("title")).toBe("Add a stop to this day first");
  });

  it("confirms what was kept once the save lands", async () => {
    renderFlag();
    await userEvent.click(screen.getByRole("button", { name: "Keep day 1" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText('Kept "Day 1 of Kyoto"')).toBeTruthy();
  });
});

// The design's `wave` (`Trip Planner Redesign.dc.html:4839`), which the build
// shipped without — Mitchell, 2026-09-01: "The click flag 'Save a day'
// animation from timeline view is missing".
//
// Asserted through the class the animation is defined against rather than
// through computed styles: jsdom does not run CSS animations, so a style
// assertion here would be asserting jsdom's defaults. The class is the seam —
// `globals.css` owns the keyframes and the `prefers-reduced-motion` drop.
describe("the keep-day pennant's wave", () => {
  // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
  const wavingFlag = () => document.querySelector(".flag-wave");

  it("does not wave until it is pressed", () => {
    renderFlag();
    expect(wavingFlag()).toBeNull();
  });

  it("waves on a press", async () => {
    renderFlag();
    await userEvent.click(screen.getByRole("button", { name: "Keep day 1" }));
    expect(wavingFlag()).not.toBeNull();
  });

  it("stops waving when the animation finishes, so a second press waves again", async () => {
    renderFlag();
    const button = screen.getByRole("button", { name: "Keep day 1" });
    await userEvent.click(button);
    const waving = wavingFlag();
    expect(waving).not.toBeNull();

    // The class is removed on `animationend` — a class left behind is an
    // animation that plays exactly once per mount, which is the bug this
    // handler exists to avoid.
    //
    // Two details, both load-bearing rather than defensive. `bubbles: true`,
    // because React delegates its listeners at the root and testing-library's
    // default init for this event is non-bubbling. And `webkitAnimationEnd`
    // rather than `animationend`, because jsdom implements neither
    // `AnimationEvent` nor `onanimationend` (verified: `"onanimationend" in
    // div` is false while `"onwebkitanimationend"` is true), so React's own
    // `getVendorPrefixedEventName` resolves `onAnimationEnd` to the prefixed
    // listener in this environment. A plain `fireEvent.animationEnd` reaches
    // nothing here and would fail against working code; a real browser fires
    // the unprefixed event into the same handler.
    fireEvent(waving!, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(wavingFlag()).toBeNull();

    // The class going away is only half the claim in this test's name — the
    // other half is that a LATER press still waves, i.e. `animationend`
    // clearing the class doesn't also clear whatever makes the class
    // re-applicable. Without this second press, a regression that cleared
    // `waving` once and then never set it again on a later click would still
    // pass (CodeRabbit, PR 104).
    //
    // The first click's dialog is still open at this point — `keep()` never
    // closes it, only the wave-ending `animationend` fired above — and its
    // Radix overlay covers the button with `pointer-events: none` while
    // mounted, so a second `userEvent.click(button)` here throws rather than
    // landing. Dismissing via Cancel (not asserting anything about the
    // dialog) is what makes the second press reach the button at all.
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await userEvent.click(button);
    expect(wavingFlag()).not.toBeNull();
  });

  it("does not wave on a day with nothing on it", async () => {
    renderFlag({ stops: [] });
    await userEvent.click(screen.getByRole("button", { name: "Keep day 1" }));
    expect(wavingFlag()).toBeNull();
  });
});
