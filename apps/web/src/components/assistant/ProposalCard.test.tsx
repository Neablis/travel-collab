import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposalCard, proposalUndoFor, proposalWords, type ProposalState } from "./ProposalCard";
import type { AssistantProposal, HistoryEntry, TripHistory } from "@tc/contracts";

afterEach(cleanup);

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const UUID = "22222222-2222-4222-8222-222222222222";
const MINE = "33333333-3333-4333-8333-333333333333";
const THEIRS = "44444444-4444-4444-8444-444444444444";

const PROPOSAL: AssistantProposal = {
  proposalId: "p1",
  changes: [
    { type: "AddActivity", text: "Add “Sample: coffee stop” to day 2" },
    { type: "AddActivity", text: "Add “Sample: evening stroll” to day 2" },
  ],
  commands: [
    { type: "AddActivity", tripId: TRIP_ID, activityId: UUID, dayId: UUID, title: "Sample: coffee stop" },
    { type: "AddActivity", tripId: TRIP_ID, activityId: UUID, dayId: UUID, title: "Sample: evening stroll" },
  ],
  inserts: [],
  skipped: [],
};

function state(overrides: Partial<ProposalState> = {}): ProposalState {
  return { proposal: PROPOSAL, status: "pending", note: null, ...overrides };
}

function renderCard(overrides: Partial<React.ComponentProps<typeof ProposalCard>> = {}) {
  const props = { state: state(), onApprove: vi.fn(), onReject: vi.fn(), ...overrides };
  render(<ProposalCard {...props} />);
  return props;
}

const card = () => screen.getByRole("group", { name: "Suggested change" });

describe("ProposalCard", () => {
  // M27 D16: the words are derived from the proposal — the contract carries
  // only the server's sentence per change, and is not widened for a title.
  it("counts several changes in the title and lists every one under it", () => {
    renderCard();
    expect(card().textContent).toContain("2 changes");
    expect(card().textContent).toContain("Add “Sample: coffee stop” to day 2");
    expect(card().textContent).toContain("Add “Sample: evening stroll” to day 2");
  });

  it("makes a single change its own title, and puts what was skipped under it", () => {
    expect(
      proposalWords({
        ...PROPOSAL,
        changes: [{ type: "AddActivity", text: "Move it 30 minutes later" }],
        skipped: ["No activity named “Nope”."],
      }),
    ).toEqual({ title: "Move it 30 minutes later", detail: "No activity named “Nope”." });
  });

  it("shows two identical changes as two", () => {
    const words = proposalWords({
      ...PROPOSAL,
      changes: [
        { type: "AddDay", text: "Add a day" },
        { type: "AddDay", text: "Add a day" },
      ],
    });
    expect(words).toEqual({ title: "2 changes", detail: "Add a day · Add a day" });
  });

  // The one thing this card exists to say before it is decided: nothing has
  // happened yet. The prose above it is the model's.
  it("says it is waiting on you, and never that it is done", () => {
    renderCard();
    expect(within(card()).getByText("Ready when you are")).not.toBeNull();
    expect(card().textContent).not.toContain("✓");
  });

  it("makes the change and declines it through the buttons, by CLICK", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Make the change" }));
    expect(props.onApprove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(props.onReject).toHaveBeenCalledTimes(1);
  });

  it("disables the change and says why when the board cannot take an outcome", () => {
    renderCard({ disabled: true, disabledReason: "Finish saving your changes before applying this." });
    expect((screen.getByRole("button", { name: "Make the change" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Finish saving your changes before applying this.")).not.toBeNull();
    // Declining is always available: it sends nothing.
    expect((screen.getByRole("button", { name: "Not now" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("settles to the server's receipt once applied, with no second chance to apply", () => {
    renderCard({ state: state({ status: "applied", note: "Done — added “Sample: coffee stop” to day 2." }) });
    expect(card().textContent).toContain("✓ Done — added “Sample: coffee stop” to day 2.");
    expect(screen.queryByRole("button", { name: "Make the change" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
  });

  // The claim the whole decline path rests on, said on screen: nothing
  // happened, so there is nothing to undo.
  it("says the trip was left alone when declined", () => {
    renderCard({ state: state({ status: "rejected" }) });
    expect(card().textContent).toBe("Left as it is.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays open after a refused batch, and says why it was refused", () => {
    renderCard({ state: state({ status: "failed", note: "someone else changed this trip" }) });
    expect(screen.getByText("someone else changed this trip")).not.toBeNull();
    // Atomic: a refusal applied nothing, so trying again is the honest affordance.
    expect(screen.getByRole("button", { name: "Make the change" })).not.toBeNull();
    expect(within(card()).getByText("Ready when you are")).not.toBeNull();
  });

  it("holds both buttons while the batch is in flight", () => {
    renderCard({ state: state({ status: "applying" }) });
    const applying = screen.getByRole("button", { name: "Applying…" }) as HTMLButtonElement;
    expect(applying.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Not now" }) as HTMLButtonElement).disabled).toBe(true);
  });

  // M27 D17, drawn: Undo while it is honest, a pointer at History when it is
  // not, and the trip's own word for it once it has happened.
  describe("once applied", () => {
    const applied = state({ status: "applied", note: "Moved 30 minutes later on Day 8.", batchId: MINE });

    it("offers Undo while the change is still the last one", () => {
      const onUndo = vi.fn();
      renderCard({ state: applied, undo: "available", onUndo });
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(onUndo).toHaveBeenCalledTimes(1);
      expect(card().textContent).not.toContain("Changed since");
    });

    it("withholds Undo once something has changed since, and says where to go", () => {
      renderCard({ state: applied, undo: "changed", onUndo: vi.fn() });
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
      expect(card().textContent).toContain("Changed since — undo it from History.");
    });

    it("says it was put back once it has been undone", () => {
      renderCard({ state: applied, undo: "undone", onUndo: vi.fn() });
      expect(card().textContent).toBe("Put back the way it was.");
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });
  });
});

describe("proposalUndoFor", () => {
  function entry(batchId: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
    return {
      batchId,
      fromSeq: 1,
      toSeq: 2,
      actorId: "dev-alice",
      occurredAt: "2026-09-23T10:00:00.000Z",
      origin: { kind: "user" },
      description: "A change",
      undone: false,
      ...overrides,
    };
  }
  const history = (entries: HistoryEntry[], canUndo = true): TripHistory => ({
    tripId: TRIP_ID,
    entries,
    canUndo,
    canRedo: false,
  });
  const applied = state({ status: "applied", note: "Done.", batchId: MINE });

  it("is available while this card's batch is the head of the trip's history", () => {
    expect(proposalUndoFor(applied, history([entry(MINE), entry(THEIRS)]))).toBe("available");
  });

  // The reason D17 exists: `UndoLastChange` undoes the LAST batch, whoever
  // made it, so once somebody has written since, Undo here would take back
  // THEIR change.
  it("is withheld once anyone has written since", () => {
    expect(proposalUndoFor(applied, history([entry(THEIRS), entry(MINE)]))).toBe("changed");
  });

  it("reads undone off the history, however it was undone", () => {
    const undoneBatch = entry(UUID, { origin: { kind: "undo", undoesBatchId: MINE } });
    expect(proposalUndoFor(applied, history([undoneBatch, entry(MINE, { undone: true })]))).toBe("undone");
  });

  it("says nothing for a card that is not applied, or whose batch is unknown", () => {
    expect(proposalUndoFor(state(), history([entry(MINE)]))).toBeNull();
    expect(proposalUndoFor({ ...applied, batchId: null }, history([entry(MINE)]))).toBeNull();
    expect(proposalUndoFor(applied, null)).toBeNull();
  });
});
