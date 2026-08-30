import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivityKind, ActivityTag, ActivityView } from "@tc/contracts";
import { ActivityCard } from "./ActivityCard";

const ACTIVITY_ID = "11111111-1111-4111-8111-111111111111";
const DAY_ID = "33333333-3333-4333-8333-333333333333";

function activity(overrides: Partial<ActivityView> = {}): ActivityView {
  return {
    activityId: ACTIVITY_ID,
    title: "Colosseum",
    timeWindow: { start: "09:00", end: "11:00" },
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    ...overrides,
  };
}

function renderCard(overrides: Partial<ActivityView> = {}, props: { readOnly?: boolean; hasConflict?: boolean } = {}) {
  return render(
    <ul>
      <ActivityCard
        activity={activity(overrides)}
        dayId={DAY_ID}
        hasConflict={props.hasConflict ?? false}
        overlap={null}
        currency="EUR"
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onDismissOverlap={vi.fn()}
        readOnly={props.readOnly ?? false}
      />
    </ul>,
  );
}

describe("ActivityCard kind badge", () => {
  // The handoff's own map (`Trip Planner Redesign.dc.html:3740`), verbatim.
  const cases: [ActivityKind, string][] = [
    ["booked", "Booked"],
    ["hold", "Holding"],
    ["idea", "Idea"],
    ["transit", "Travel"],
  ];

  it.each(cases)("renders the %s badge as %s", (kind, label) => {
    renderCard({ kind });
    expect(within(screen.getByTestId(`kind-badge-${ACTIVITY_ID}`)).getByText(label)).toBeTruthy();
  });

  // Not an oversight: the handoff's map falls through to an empty string for
  // `planned`, and `planned` is the contract's zero value — a "Planned" badge
  // would sit on 68 of 68 seeded stops and signal nothing.
  it("renders no badge at all for planned", () => {
    renderCard({ kind: "planned" });
    expect(screen.queryByTestId(`kind-badge-${ACTIVITY_ID}`)).toBeNull();
    expect(screen.queryByText("Planned")).toBeNull();
  });

  it("sits beside the conflict badge rather than replacing it", () => {
    renderCard({ kind: "booked" }, { hasConflict: true });
    expect(screen.getByLabelText("conflict")).toBeTruthy();
    expect(screen.getByTestId(`kind-badge-${ACTIVITY_ID}`)).toBeTruthy();
  });

  // A badge reads the plan; it is not an affordance that changes it.
  it("still renders for a viewer", () => {
    renderCard({ kind: "hold" }, { readOnly: true });
    expect(screen.getByTestId(`kind-badge-${ACTIVITY_ID}`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Colosseum" })).toBeNull();
  });
});

describe("ActivityCard tag chips", () => {
  const cases: [ActivityTag, string][] = [
    ["meal", "Meal"],
    ["lodging", "Lodging"],
    ["ticketed", "Ticketed"],
    ["outdoors", "Outdoors"],
  ];

  it.each(cases)("renders a chip for %s", (tag, label) => {
    renderCard({ tags: [tag] });
    expect(within(screen.getByTestId(`tag-chips-${ACTIVITY_ID}`)).getByText(label)).toBeTruthy();
  });

  it("renders every tag on the stop, in the order it carries them", () => {
    renderCard({ tags: ["ticketed", "meal"] });
    const chips = within(screen.getByTestId(`tag-chips-${ACTIVITY_ID}`)).getAllByTestId(/^tag-chip-/);
    expect(chips.map((c) => c.textContent)).toEqual(["Ticketed", "Meal"]);
  });

  it("renders no chip row at all when the stop has no tags", () => {
    renderCard({ tags: [] });
    expect(screen.queryByTestId(`tag-chips-${ACTIVITY_ID}`)).toBeNull();
  });

  // Display-only in M18: tag focus (SPEC §11) is M18b. A chip that looked
  // clickable and did nothing would be worse than one that does not.
  it("renders chips as text, not controls", () => {
    renderCard({ tags: ["meal", "lodging"] });
    const chips = within(screen.getByTestId(`tag-chips-${ACTIVITY_ID}`)).getAllByTestId(/^tag-chip-/);
    for (const chip of chips) expect(chip.tagName).toBe("SPAN");
    expect(within(screen.getByTestId(`tag-chips-${ACTIVITY_ID}`)).queryByRole("button")).toBeNull();
  });

  it("still renders for a viewer", () => {
    renderCard({ tags: ["outdoors"] }, { readOnly: true });
    expect(screen.getByTestId(`tag-chips-${ACTIVITY_ID}`)).toBeTruthy();
  });
});
