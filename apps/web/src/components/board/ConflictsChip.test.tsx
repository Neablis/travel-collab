import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActivityView, Conflict } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { ConflictsChip } from "./ConflictsChip";

// The phone's conflict state (M39 D9). The rows are `ConflictRow`, whose
// Dismiss rules (concurrent-edit, read-only) ConflictBanner.test.tsx owns; what
// is the chip's own is the count, the sheet, and where a jump goes.
const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";

const activities: Record<string, ActivityView> = (() => {
  const base = Object.values(tripDetailFixture().activities)[0]!;
  return {
    [A1]: { ...base, activityId: A1, title: "Colosseum" },
    [A2]: { ...base, activityId: A2, title: "Vatican Museums" },
  };
})();

const overlap: Conflict = {
  id: "time-overlap:d1:a1:a2",
  kind: "time-overlap",
  severity: "warn",
  subjects: [A1, A2],
  description: '"Colosseum" and "Vatican Museums" overlap in time on the same day.',
  resolutions: [],
};
const overBudget: Conflict = {
  id: "over-budget:t1",
  kind: "over-budget",
  severity: "warn",
  subjects: ["trip-1"],
  description: "Planned costs are over the trip budget.",
  resolutions: [],
};

function mount(props: Partial<React.ComponentProps<typeof ConflictsChip>> = {}) {
  const onJump = vi.fn();
  const onDismiss = vi.fn();
  const view = render(
    <ConflictsChip
      conflicts={[overlap, overBudget]}
      dismissedConflictIds={[]}
      activities={activities}
      onDismiss={onDismiss}
      onJump={onJump}
      {...props}
    />,
  );
  return { onJump, onDismiss, ...view };
}

describe("ConflictsChip", () => {
  it("counts what is left to look at, and is absent when nothing is", () => {
    const { rerender } = mount({ dismissedConflictIds: [overBudget.id] });
    expect(screen.getByRole("button", { name: "1 thing to look at" })).toBeTruthy();

    rerender(
      <ConflictsChip
        conflicts={[overlap, overBudget]}
        dismissedConflictIds={[overlap.id, overBudget.id]}
        activities={activities}
        onDismiss={vi.fn()}
        onJump={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /to look at/ })).toBeNull();
  });

  it("opens a sheet listing every conflict, with a jump only where there is a stop", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "2 things to look at" }));

    const sheet = await screen.findByRole("dialog", { name: "Things to look at" });
    expect(within(sheet).getByText(/overlap in time/)).toBeTruthy();
    expect(within(sheet).getByText(/over the trip budget/)).toBeTruthy();
    // The budget is about the trip, which has no card to go to.
    expect(within(sheet).getAllByRole("button", { name: /^Jump to/ })).toHaveLength(1);
  });

  it("closes the sheet and hands the stop to the jump", async () => {
    const { onJump } = mount();
    await userEvent.click(screen.getByRole("button", { name: "2 things to look at" }));
    await userEvent.click(await screen.findByRole("button", { name: "Jump to Colosseum" }));

    expect(onJump).toHaveBeenCalledWith(A1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dismisses through the same command path, and offers no Dismiss read-only", async () => {
    const { onDismiss, unmount } = mount();
    await userEvent.click(screen.getByRole("button", { name: "2 things to look at" }));
    await userEvent.click(await screen.findByRole("button", { name: `Dismiss: ${overlap.description}` }));
    expect(onDismiss).toHaveBeenCalledWith(overlap.id);
    unmount();

    mount({ readOnly: true });
    await userEvent.click(screen.getByRole("button", { name: "2 things to look at" }));
    await screen.findByRole("dialog", { name: "Things to look at" });
    expect(screen.queryByRole("button", { name: /^Dismiss/ })).toBeNull();
  });

  it("does not come back open after the last one went", async () => {
    const props = { activities, onDismiss: vi.fn(), onJump: vi.fn() };
    const { rerender } = render(<ConflictsChip conflicts={[overlap]} dismissedConflictIds={[]} {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "1 thing to look at" }));
    await screen.findByRole("dialog");

    rerender(<ConflictsChip conflicts={[overlap]} dismissedConflictIds={[overlap.id]} {...props} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    // A new conflict brings the count back, and only the count.
    rerender(<ConflictsChip conflicts={[overlap, overBudget]} dismissedConflictIds={[overlap.id]} {...props} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "1 thing to look at" })).toBeTruthy();
  });
});
