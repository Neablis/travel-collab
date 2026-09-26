import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivityView } from "@tc/contracts";
import { activityFactory } from "@tc/factories";
import { DayRiver } from "./DayRiver";
import { riverAxis } from "./riverLayout";

// M29 part 2 — how each kind of stop is drawn on the river (SPEC §36.9b). The
// styling itself is the colour wall's to own; what is asserted here is what a
// person can tell apart without it: the word in the block's corner, and the
// kind in the name a screen reader hears. The geometry is `riverLayout.test.ts`.

function renderRiver(stops: ActivityView[], readOnly = false) {
  const activities = Object.fromEntries(stops.map((s) => [s.activityId, s]));
  render(
    <DayRiver
      title="Day 1"
      axis={riverAxis(stops.map((s) => s.timeWindow))}
      activityIds={stops.map((s) => s.activityId)}
      activities={activities}
      accent="brand"
      conflictIds={new Set()}
      overlaps={new Map()}
      overlapPartners={new Map()}
      currency="EUR"
      onEditActivity={vi.fn()}
      onRemoveActivity={vi.fn()}
      onDismissOverlap={vi.fn()}
      focusedTag={null}
      onToggleTag={vi.fn()}
      readOnly={readOnly}
    />,
  );
}

const block = (id: string) => within(screen.getByTestId(`activity-card-${id}`));

describe("a river block says how locked in its stop is", () => {
  const planned = activityFactory.build({ title: "Museum", kind: "planned", timeWindow: { start: "09:00", end: "10:00" } });
  const toBook = activityFactory.build({ title: "Sushi", kind: "pending", pendingReason: "book", timeWindow: { start: "11:00", end: "12:00" } });
  const maybe = activityFactory.build({ title: "Garden", kind: "pending", pendingReason: "maybe", timeWindow: { start: "13:00", end: "14:00" } });
  const pending = activityFactory.build({ title: "Bar", kind: "pending", pendingReason: null, timeWindow: { start: "15:00", end: "16:00" } });
  const transit = activityFactory.build({ title: "Shinkansen", kind: "transit", mode: "train", timeWindow: { start: "16:30", end: "18:45" } });

  it("names every kind, and marks each pending and transit block in its corner", () => {
    renderRiver([planned, toBook, maybe, pending, transit]);

    expect(screen.getByRole("button", { name: "Edit Museum, 9 am – 10 am, Planned" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Sushi, 11 am – 12 pm, To book" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Garden, 1 pm – 2 pm, Maybe" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Bar, 3 pm – 4 pm, Pending" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Shinkansen, 4:30 pm – 6:45 pm, Train, 2 h 15 m" })).toBeTruthy();

    expect(block(toBook.activityId).getByText("To book")).toBeTruthy();
    expect(block(maybe.activityId).getByText("Maybe")).toBeTruthy();
    expect(block(pending.activityId).getByText("Pending")).toBeTruthy();
    // A transit leg leads with how it travels, and its tag is how long.
    expect(block(transit.activityId).getByText("Train · Shinkansen")).toBeTruthy();
    expect(block(transit.activityId).getByText("2 h 15 m")).toBeTruthy();
  });

  it("leaves a planned block unmarked — it is the default, and a word on every stop separates nothing", () => {
    renderRiver([planned]);
    for (const word of ["Planned", "To book", "Maybe", "Pending", "Overlap"]) {
      expect(block(planned.activityId).queryByText(word)).toBeNull();
    }
  });

  it("says the same to a reader, who gets no edit button", () => {
    renderRiver([toBook], true);
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.getByText("Sushi, 11 am – 12 pm, To book")).toBeTruthy();
  });
});

describe("what a block has room to say", () => {
  it("shows tags only once the block is tall enough to hold them", () => {
    // 30 minutes is 20px of axis (drawn at the 24px minimum); two hours is 86.
    const short = activityFactory.build({ title: "Check in", tags: ["lodging"], timeWindow: { start: "09:00", end: "09:30" } });
    const long = activityFactory.build({ title: "Dinner", tags: ["meal"], timeWindow: { start: "19:00", end: "21:00" } });
    renderRiver([short, long]);

    expect(block(short.activityId).queryByRole("button", { name: /lodging/ })).toBeNull();
    expect(block(long.activityId).getByRole("button", { name: "Dim everything that is not meal" })).toBeTruthy();
  });
});
