import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function renderCard(
  overrides: Partial<ActivityView> = {},
  props: {
    readOnly?: boolean;
    hasConflict?: boolean;
    focusedTag?: ActivityTag | null;
    onToggleTag?: (tag: ActivityTag) => void;
  } = {},
) {
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
        focusedTag={props.focusedTag ?? null}
        onToggleTag={props.onToggleTag}
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

  // The M18 fallback, kept as a real contract rather than as history: a
  // caller that hands down no `onToggleTag` has no focus state to drive, and a
  // chip that looked clickable and did nothing would be worse than one that
  // plainly reads.
  it("renders chips as text, not controls, when no toggle is given", () => {
    renderCard({ tags: ["meal", "lodging"] });
    const chips = within(screen.getByTestId(`tag-chips-${ACTIVITY_ID}`)).getAllByTestId(/^tag-chip-/);
    expect(chips).toHaveLength(2);
    // "Not a control" is a role claim, not a tag-name one — a `<span>`
    // assertion would also fail on a perfectly good `<div>` and pass on a span
    // that had been given `role="button"`.
    expect(within(screen.getByTestId(`tag-chips-${ACTIVITY_ID}`)).queryByRole("button")).toBeNull();
  });

  it("still renders for a viewer", () => {
    renderCard({ tags: ["outdoors"] }, { readOnly: true });
    expect(screen.getByTestId(`tag-chips-${ACTIVITY_ID}`)).toBeTruthy();
  });
});

// M18b — SPEC §11: "Tag chips on a stop are now the control".
describe("ActivityCard tag focus", () => {
  it("renders chips as toggle buttons once a toggle is given", () => {
    renderCard({ tags: ["meal"] }, { onToggleTag: vi.fn() });
    const chip = screen.getByTestId("tag-chip-meal");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });

  it("reports the clicked tag", async () => {
    const onToggleTag = vi.fn();
    renderCard({ tags: ["meal", "outdoors"] }, { onToggleTag });
    await userEvent.click(screen.getByTestId("tag-chip-outdoors"));
    expect(onToggleTag).toHaveBeenCalledExactlyOnceWith("outdoors");
  });

  // The card reports the tag and the provider decides; "click it again to
  // clear" is one rule in FocusProvider rather than one per chip, so the chip
  // raises the same event whether or not it is the focused one.
  it("reports the same tag again when it is already focused, rather than clearing itself", async () => {
    const onToggleTag = vi.fn();
    renderCard({ tags: ["meal"] }, { onToggleTag, focusedTag: "meal" });
    const chip = screen.getByTestId("tag-chip-meal");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(chip);
    expect(onToggleTag).toHaveBeenCalledExactlyOnceWith("meal");
  });

  it("rings the focused chip and only the focused chip", () => {
    renderCard({ tags: ["meal", "lodging"] }, { onToggleTag: vi.fn(), focusedTag: "meal" });
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByTestId("tag-chip-meal").className).toContain("ring-brand");
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.getByTestId("tag-chip-lodging").className).not.toContain("ring-brand");
  });

  it("carries the handoff's hover hint, both ways round", () => {
    renderCard({ tags: ["meal"] }, { onToggleTag: vi.fn() });
    expect(screen.getByTestId("tag-chip-meal").getAttribute("title")).toBe("Dim everything that is not meal");

    renderCard({ tags: ["lodging"] }, { onToggleTag: vi.fn(), focusedTag: "lodging" });
    expect(screen.getByTestId("tag-chip-lodging").getAttribute("title")).toBe("Stop focusing on lodging");
  });

  it("dims a stop that does not carry the focused tag", () => {
    renderCard({ tags: ["outdoors"] }, { onToggleTag: vi.fn(), focusedTag: "meal" });
    const card = screen.getByTestId(`activity-card-${ACTIVITY_ID}`);
    expect(card.getAttribute("data-off-tag")).toBe("true");
    expect(Number(card.style.opacity)).toBeCloseTo(0.32);
  });

  it("leaves a matching stop, and every stop with no focus, at full strength", () => {
    renderCard({ tags: ["meal", "outdoors"] }, { onToggleTag: vi.fn(), focusedTag: "meal" });
    expect(screen.getByTestId(`activity-card-${ACTIVITY_ID}`).style.opacity).toBe("1");

    renderCard({ tags: [] }, { onToggleTag: vi.fn(), focusedTag: null });
    expect(screen.getAllByTestId(`activity-card-${ACTIVITY_ID}`)[1]!.style.opacity).toBe("1");
  });

  // Dim, never hide — the whole argument for replacing the filter row. An
  // untagged stop still renders every word it rendered before.
  it("still renders a dimmed stop in full", () => {
    renderCard({ tags: [], title: "Colosseum" }, { onToggleTag: vi.fn(), focusedTag: "meal" });
    expect(screen.getByText("Colosseum")).toBeTruthy();
    expect(screen.getByTestId(`activity-card-${ACTIVITY_ID}`)).toBeTruthy();
  });

  // Focus dims a view; it does not change a trip. /demo's signed-out reader is
  // the surface M18b's own gate is walked on, so a viewer gets the whole
  // behaviour — unlike every affordance ADR-031 takes away.
  it("keeps the chips live for a viewer", async () => {
    const onToggleTag = vi.fn();
    renderCard({ tags: ["meal"] }, { onToggleTag, readOnly: true });
    await userEvent.click(screen.getByTestId("tag-chip-meal"));
    expect(onToggleTag).toHaveBeenCalledExactlyOnceWith("meal");
    expect(screen.queryByRole("button", { name: "Edit Colosseum" })).toBeNull();
  });
});
