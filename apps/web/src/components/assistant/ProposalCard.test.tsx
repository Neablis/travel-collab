import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposalCard, type ProposalState } from "./ProposalCard";
import type { AssistantProposal } from "@/lib/apiClient";

afterEach(cleanup);

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const UUID = "22222222-2222-4222-8222-222222222222";

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

describe("ProposalCard", () => {
  it("lists every change the batch would make, one per line", () => {
    renderCard();
    const list = screen.getByRole("list", { name: "Changes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list.textContent).toContain("Add “Sample: coffee stop” to day 2");
    expect(list.textContent).toContain("Add “Sample: evening stroll” to day 2");
  });

  // The one thing this card exists to say. The prose above it is the model's;
  // this is the server's, and it must not read as a receipt.
  it("says the change has not been applied, and never says it has", () => {
    renderCard();
    expect(screen.getByText("Not applied yet")).not.toBeNull();
    expect(screen.queryByText(/^Done —/)).toBeNull();
  });

  it("shows two identical changes as two lines", () => {
    renderCard({
      state: state({
        proposal: {
          ...PROPOSAL,
          changes: [
            { type: "AddDay", text: "Add a day" },
            { type: "AddDay", text: "Add a day" },
          ],
        },
      }),
    });
    expect(within(screen.getByRole("list", { name: "Changes" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("names what the server could not match, beside what it could", () => {
    renderCard({
      state: state({ proposal: { ...PROPOSAL, skipped: ["No activity named “Nope”."] } }),
    });
    expect(screen.getByRole("list", { name: "Skipped changes" }).textContent).toContain("No activity named “Nope”.");
  });

  it("approves and rejects through the buttons, by CLICK", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(props.onApprove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(props.onReject).toHaveBeenCalledTimes(1);
  });

  it("disables Approve and says why when the board cannot take an outcome", () => {
    renderCard({ disabled: true, disabledReason: "Finish saving your changes before applying this." });
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Finish saving your changes before applying this.")).not.toBeNull();
    // Rejecting is always available: it sends nothing.
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server's receipt once applied, and offers no second Approve", () => {
    renderCard({ state: state({ status: "applied", note: "Done — added “Sample: coffee stop” to day 2." }) });
    expect(screen.getByText("Applied")).not.toBeNull();
    expect(screen.getByText("Done — added “Sample: coffee stop” to day 2.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  // The claim the whole reject path rests on, said on screen: nothing
  // happened, so there is nothing to undo.
  it("says nothing changed when rejected", () => {
    renderCard({ state: state({ status: "rejected" }) });
    expect(screen.getByText("Rejected")).not.toBeNull();
    expect(screen.getByText("Discarded — nothing on the trip changed.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("keeps Approve available after a refused batch, and says why it was refused", () => {
    renderCard({ state: state({ status: "failed", note: "someone else changed this trip" }) });
    expect(screen.getByText("someone else changed this trip")).not.toBeNull();
    // Atomic: a refusal applied nothing, so retrying is the honest affordance.
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeNull();
    expect(screen.getByText("Not applied yet")).not.toBeNull();
  });

  it("offers neither button while the batch is in flight", () => {
    renderCard({ state: state({ status: "applying" }) });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.getByText("Applying…")).not.toBeNull();
  });
});
