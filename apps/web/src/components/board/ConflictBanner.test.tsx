import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActivityView, Conflict } from "@tc/contracts";
import { ConflictBanner } from "./ConflictBanner";

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";

function activity(id: string, title: string): ActivityView {
  return { activityId: id, title, timeWindow: null, location: null, notes: null, anchors: [], cost: null };
}

function overlapConflict(): Conflict {
  return {
    id: "time-overlap:d1:a1:a2",
    kind: "time-overlap",
    severity: "warn",
    subjects: [A1, A2],
    description: '"Colosseum" and "Vatican Museums" overlap in time on the same day.',
    resolutions: ["Change one activity's time window", "Move one activity to another day or the backlog"],
  };
}

describe("ConflictBanner", () => {
  it("drops the remedy list from the banner copy — only the description renders", () => {
    render(
      <ConflictBanner
        conflicts={[overlapConflict()]}
        dismissedConflictIds={[]}
        activities={{ [A1]: activity(A1, "Colosseum"), [A2]: activity(A2, "Vatican Museums") }}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText(/overlap in time on the same day/)).toBeTruthy();
    expect(screen.queryByText(/Change one activity's time window/)).toBeNull();
    expect(screen.queryByText(/Move one activity to another day or the backlog/)).toBeNull();
  });

  it("jumps to the conflict's first subject on click", async () => {
    const onSelectActivity = vi.fn();
    render(
      <ConflictBanner
        conflicts={[overlapConflict()]}
        dismissedConflictIds={[]}
        activities={{ [A1]: activity(A1, "Colosseum"), [A2]: activity(A2, "Vatican Museums") }}
        onDismiss={vi.fn()}
        onSelectActivity={onSelectActivity}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Jump to Colosseum" }));
    expect(onSelectActivity).toHaveBeenCalledWith(A1);
  });

  it("jumps on keyboard activation (Enter and Space), same as any other button", async () => {
    const onSelectActivity = vi.fn();
    render(
      <ConflictBanner
        conflicts={[overlapConflict()]}
        dismissedConflictIds={[]}
        activities={{ [A1]: activity(A1, "Colosseum"), [A2]: activity(A2, "Vatican Museums") }}
        onDismiss={vi.fn()}
        onSelectActivity={onSelectActivity}
      />,
    );

    const jumpButton = screen.getByRole("button", { name: "Jump to Colosseum" });
    jumpButton.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelectActivity).toHaveBeenCalledTimes(1);

    await userEvent.keyboard(" ");
    expect(onSelectActivity).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the conflict's subject no longer exists in the trip", () => {
    const onSelectActivity = vi.fn();
    render(
      <ConflictBanner
        conflicts={[overlapConflict()]}
        dismissedConflictIds={[]}
        activities={{}}
        onDismiss={vi.fn()}
        onSelectActivity={onSelectActivity}
      />,
    );

    // No jump control at all — nothing to click through to.
    expect(screen.queryByRole("button", { name: /Jump to/ })).toBeNull();
    expect(screen.getByText(/overlap in time on the same day/)).toBeTruthy();
  });
});
