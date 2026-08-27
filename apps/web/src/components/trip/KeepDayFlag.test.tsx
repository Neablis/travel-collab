import { cleanup, render, screen } from "@testing-library/react";
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
