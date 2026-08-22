import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripMember } from "@tc/contracts";
import type { TripSpend } from "@/lib/cost";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const sendTripCommandMock = vi.fn();
const duplicateTripMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  sendTripCommand: (...args: unknown[]) => sendTripCommandMock(...args),
  duplicateTrip: (...args: unknown[]) => duplicateTripMock(...args),
}));

import { SettingsSheet } from "./SettingsSheet";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

afterEach(cleanup);

beforeEach(() => {
  pushMock.mockReset();
  sendTripCommandMock.mockReset();
  duplicateTripMock.mockReset();
});

const defaultSpend: TripSpend = {
  total: 150_000,
  unpriced: 2,
  budget: 500_000,
  remaining: 350_000,
  over: false,
};

const defaultMembers: TripMember[] = [{ userId: "dev-alice", role: "owner" }];

// Existing A15 helper, extended (not replaced) with the two new required
// props (#5, controller ruling) — every existing call site below keeps
// working unchanged since both take defaults.
function renderSheet(
  onDeleted = vi.fn(),
  overrides: { spend?: TripSpend; members?: TripMember[] } = {},
) {
  render(
    <SettingsSheet
      tripId={tripId}
      tripName="Japan"
      open
      onOpenChange={vi.fn()}
      startDate={null}
      endDate={null}
      dayCount={0}
      currency="USD"
      budget={null}
      spend={overrides.spend ?? defaultSpend}
      members={overrides.members ?? defaultMembers}
      onCommand={vi.fn()}
      onDeleted={onDeleted}
    />,
  );
  return { onDeleted };
}

// New helper for the redesign's own coverage (brief's Step 1 snippets) — a
// thin wrapper around renderSheet that makes the budget-remaining override
// (the thing every new test below actually varies) a one-liner.
function renderSettings(
  opts: { open?: boolean; budgetRemaining?: number | null; members?: TripMember[] } = {},
) {
  const remaining = "budgetRemaining" in opts ? opts.budgetRemaining! : defaultSpend.remaining;
  const spend: TripSpend = {
    ...defaultSpend,
    remaining,
    over: remaining !== null && remaining < 0,
  };
  renderSheet(vi.fn(), { spend, members: opts.members });
}

describe("SettingsSheet redesign (Task 4.2)", () => {
  it("shows the trip name, read-only dates and the budget fields", () => {
    renderSettings({ open: true });

    expect(screen.getByLabelText("Trip name")).toBeTruthy();
    expect(screen.getByText("Dates")).toBeTruthy();
    expect(screen.getByLabelText("Total for the trip")).toBeTruthy();
    expect(screen.getByLabelText("Currency")).toBeTruthy();
  });

  it("warns when the trip is over budget", () => {
    renderSettings({ open: true, budgetRemaining: -82_000 });
    // No @testing-library/jest-dom in this repo (grep confirms no other test
    // uses toHaveTextContent) — match textContent directly, same pattern as
    // TripDateControl.test.tsx's dialog-text assertion.
    expect(screen.getByRole("status").textContent).toMatch(/over/i);
  });

  it("does not warn when the trip is within budget", () => {
    renderSettings({ open: true, budgetRemaining: 731_500 });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("counts stops with no cost", () => {
    renderSettings({ open: true });
    expect(screen.getByText(/no cost yet/i)).toBeTruthy();
  });

  it("lists real members", () => {
    renderSettings({ open: true });
    expect(screen.getByText("dev-alice")).toBeTruthy();
  });
});

describe("SettingsSheet delete/duplicate (A15)", () => {
  it("confirms before deleting, then reports success (with the outcome) via onDeleted", async () => {
    const outcome = { detail: { status: "deleted" }, history: {} };
    sendTripCommandMock.mockResolvedValue({ ok: true, value: outcome });
    const { onDeleted } = renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /^delete trip$/i }));
    // Confirmation gate: the command isn't sent until the dialog is confirmed.
    expect(sendTripCommandMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(sendTripCommandMock).toHaveBeenCalledWith({ type: "DeleteTrip", tripId }),
    );
    // A15-fix: the outcome is forwarded alongside the summary so the caller
    // (TripHeader) can feed it into applyOutcome and reconcile trip.status
    // immediately, rather than only after the toast closes.
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith({ tripId, name: "Japan" }, outcome));
  });

  it("does not report success when the delete command fails", async () => {
    sendTripCommandMock.mockResolvedValue({ ok: false, error: { status: 400, message: "nope" } });
    const { onDeleted } = renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /^delete trip$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(sendTripCommandMock).toHaveBeenCalled());
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("duplicates the trip and navigates to the copy", async () => {
    const newTripId = "9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a";
    duplicateTripMock.mockResolvedValue({ ok: true, value: { tripId: newTripId } });
    renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /duplicate trip/i }));

    await waitFor(() => expect(duplicateTripMock).toHaveBeenCalledWith(tripId));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${newTripId}`));
  });
});
