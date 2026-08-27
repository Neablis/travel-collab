import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripCommand } from "@tc/contracts";
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

// The Travelers section is TravelersPanel's own surface (and its own test
// file) as of M11 link 3; it fetches /api/trips/:id/access on mount, which
// this file's tests neither stub nor care about.
vi.mock("@/components/trip/TravelersPanel", () => ({
  TravelersPanel: ({ tripId }: { tripId: string }) => <div data-testid="travelers-panel">{tripId}</div>,
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

// Existing A15 helper, extended (not replaced) with the two new required
// props (#5, controller ruling) — every existing call site below keeps
// working unchanged since both take defaults. Further extended (this task)
// with an optional onCommand override so the Dates-row wiring tests can
// capture what the sheet forwards, without inventing a second render helper.
function renderSheet(
  onDeleted = vi.fn(),
  overrides: { spend?: TripSpend; onCommand?: (command: TripCommand) => void } = {},
) {
  const onCommand = overrides.onCommand ?? vi.fn();
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
      onCommand={onCommand}
      onDeleted={onDeleted}
    />,
  );
  return { onDeleted, onCommand };
}

// New helper for the redesign's own coverage (brief's Step 1 snippets) — a
// thin wrapper around renderSheet that makes the budget-remaining override
// (the thing every new test below actually varies) a one-liner.
function renderSettings(
  opts: { open?: boolean; budgetRemaining?: number | null } = {},
) {
  const remaining = "budgetRemaining" in opts ? opts.budgetRemaining! : defaultSpend.remaining;
  const spend: TripSpend = {
    ...defaultSpend,
    remaining,
    over: remaining !== null && remaining < 0,
  };
  renderSheet(vi.fn(), { spend });
}

// Renaming lives here now: PR #55's preview feedback removed the header's
// pencil and made the title open this sheet, so this field went from readOnly
// to being the only way to rename a trip.
describe("SettingsSheet rename", () => {
  it("dispatches SetTripName on blur", async () => {
    const onCommand = vi.fn();
    renderSheet(vi.fn(), { onCommand });

    const field = screen.getByLabelText("Trip name");
    await userEvent.clear(field);
    await userEvent.type(field, "Japan 2027");
    await userEvent.tab();

    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SetTripName", name: "Japan 2027" }),
    );
  });

  // CodeRabbit, PR #55: the trimmed name was dispatched but the raw text was
  // left in the field, so the input disagreed with the trip it had just
  // renamed.
  it("shows the saved name, not the raw text, when the input had surrounding whitespace", async () => {
    const onCommand = vi.fn();
    renderSheet(vi.fn(), { onCommand });

    const field = screen.getByLabelText("Trip name");
    await userEvent.clear(field);
    await userEvent.type(field, "  Japan 2027  ");
    await userEvent.tab();

    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SetTripName", name: "Japan 2027" }),
    );
    expect((field as HTMLInputElement).value).toBe("Japan 2027");
  });

  it.each([
    ["unchanged", "Japan"],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("sends nothing and restores the field when the name is %s", async (_label, typed) => {
    const onCommand = vi.fn();
    renderSheet(vi.fn(), { onCommand });

    const field = screen.getByLabelText("Trip name");
    await userEvent.clear(field);
    if (typed !== "") await userEvent.type(field, typed);
    await userEvent.tab();

    expect(onCommand).not.toHaveBeenCalled();
    expect((field as HTMLInputElement).value).toBe("Japan");
  });
});

describe("SettingsSheet redesign (Task 4.2)", () => {
  it("shows the trip name, the dates row and the budget fields", () => {
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

  it("hides the budget meter (but still shows the status line) when no budget is set", () => {
    const noBudgetSpend: TripSpend = {
      total: 150_000,
      unpriced: 2,
      budget: null,
      remaining: null,
      over: false,
    };
    renderSheet(vi.fn(), { spend: noBudgetSpend });
    expect(screen.queryByTestId("budget-meter-fill")).toBeNull();
    expect(screen.getByText("No budget set")).toBeTruthy();
  });

  // M11 link 3 moved the member list into TravelersPanel (mocked above), so
  // what this sheet is still responsible for is mounting it for THIS trip.
  it("mounts the Travelers panel for this trip", () => {
    renderSettings({ open: true });
    expect(screen.getByTestId("travelers-panel").textContent).toBe(tripId);
  });
});

describe("SettingsSheet Dates row (restored, M10 Phase 4)", () => {
  // Not asserting Popover/TripDateControl's own mechanics — those are
  // Popover's and TripDateControl.test.tsx's tested territory — just that
  // the wiring here is real: clicking the row actually mounts
  // TripDateControl.
  it("opens TripDateControl when the Dates row is clicked", async () => {
    renderSheet();

    expect(screen.queryByLabelText("Trip start date")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Dates" }));

    expect(await screen.findByLabelText("Trip start date")).toBeTruthy();
  });

  // Task 8b.6: the end is derived, never picked — TripDateControl commits
  // the start alone, via SetTripStartDate, not SetTripDates. Selecting a
  // date now commits immediately (feedback fix, 2026-08-24) — no Done click,
  // and the commit closes the Dates popover itself (same onCommand wrapper
  // the Clear-date X used before this change).
  it("forwards a committed date change to the sheet's own onCommand as SetTripStartDate", async () => {
    const { onCommand } = renderSheet(vi.fn(), { onCommand: vi.fn() });

    await userEvent.click(screen.getByRole("button", { name: "Dates" }));
    await userEvent.type(await screen.findByLabelText("Trip start date"), "2027-01-05");

    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith({ type: "SetTripStartDate", tripId, startDate: "2027-01-05" }),
    );
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
