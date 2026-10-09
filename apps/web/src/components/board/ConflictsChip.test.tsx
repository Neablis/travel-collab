import { useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

  // The sheet has no `Dialog.Trigger` (it is state-controlled), so Radix had
  // nothing to hand focus back to and a keyboard reader landed on <body>.
  // Said through the keyboard, as TripHeader.test's History case is (the wall
  // bans reading focus directly): Enter reopens the sheet only if the chip has it.
  it("returns focus to the chip when the sheet closes", async () => {
    mount();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Things to look at" });

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Things to look at" })).toBeTruthy();
  });

  it("hands focus to the row's neighbour when the last dismiss takes the chip away", async () => {
    const onNeighbour = vi.fn();
    function Row() {
      const [dismissed, setDismissed] = useState<string[]>([]);
      const neighbour = useRef<HTMLButtonElement>(null);
      return (
        <>
          <ConflictsChip
            conflicts={[overlap]}
            dismissedConflictIds={dismissed}
            activities={activities}
            onDismiss={(id) => setDismissed((d) => [...d, id])}
            onJump={vi.fn()}
            neighbour={neighbour}
          />
          <button ref={neighbour} type="button" onClick={onNeighbour}>
            Trip actions
          </button>
        </>
      );
    }
    render(<Row />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: `Dismiss: ${overlap.description}` }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.keyboard("{Enter}");
    expect(onNeighbour).toHaveBeenCalledTimes(1);
  });

  // A jump opens the stop's editor, which takes focus in an effect of the
  // commit that closes the sheet — as a mounting Radix FocusScope does — and so
  // before the sheet's close hands focus out: the chip must not take it back.
  it("leaves focus where a jump put it", async () => {
    function Editor() {
      const field = useRef<HTMLInputElement>(null);
      useEffect(() => field.current?.focus(), []);
      return <input ref={field} aria-label="What or where" />;
    }
    function Board() {
      const [editing, setEditing] = useState(false);
      return (
        <>
          <ConflictsChip
            conflicts={[overlap]}
            dismissedConflictIds={[]}
            activities={activities}
            onDismiss={vi.fn()}
            onJump={() => setEditing(true)}
          />
          {editing && <Editor />}
        </>
      );
    }
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "1 thing to look at" }));
    await userEvent.click(await screen.findByRole("button", { name: "Jump to Colosseum" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.keyboard("Rome");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "What or where" }).value).toBe("Rome");
  });
});
