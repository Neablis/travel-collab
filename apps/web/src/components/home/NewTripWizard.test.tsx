import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, BoardCommand, CommandOutcome } from "@/lib/apiClient";
import { NewTripWizard } from "./NewTripWizard";

afterEach(cleanup);

const user = userEvent.setup({ delay: null });

function renderWizard() {
  const createTrip = vi.fn<(input: { name: string }) => Promise<ApiResult<{ tripId: string }>>>();
  // Resolves ok by default (submit() now awaits and checks each dispatch,
  // PR #32) — individual tests override with mockResolvedValueOnce/reject
  // only when they specifically want a failure path.
  const dispatch = vi.fn<(command: BoardCommand) => Promise<ApiResult<CommandOutcome>>>().mockResolvedValue({
    ok: true,
    value: {} as CommandOutcome,
  });
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <NewTripWizard
      open
      onOpenChange={onOpenChange}
      createTrip={createTrip}
      dispatch={dispatch}
      onCreated={onCreated}
    />,
  );
  return { createTrip, dispatch, onOpenChange, onCreated };
}

describe("NewTripWizard", () => {
  it("walks four steps with a progress rail", async () => {
    renderWizard();
    expect(screen.getAllByTestId("wizard-step")).toHaveLength(4);
  });

  it("creates the trip with just a name, then applies dates and budget", async () => {
    const { createTrip, dispatch } = renderWizard();
    createTrip.mockResolvedValue({ ok: true, value: { tripId: "new-trip" } });

    await user.type(screen.getByLabelText("Trip name"), "Japan");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    // Step 2 is Arrive plus a length chip — there is no Leave input to type into
    // (the 2026-08-23 amendment above). "2 weeks" is 14 days, so the end the
    // wizard computes is 2026-10-16, which is what this test then asserts.
    await user.click(screen.getByRole("button", { name: "2 weeks" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Create trip" }));

    expect(createTrip).toHaveBeenCalledWith({ name: "Japan" });
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SetTripDates",
          tripId: "new-trip",
          startDate: "2026-10-03",
          endDate: "2026-10-16",
        }),
      ),
    );
  });

  // The 2026-08-23 amendment as an enforced rule rather than a stated one:
  // AGENTS.md's testing model says an invariant a comment asserts is "a lie with
  // a timer on it" unless a test holds it. Task 8b.6 removes the same field from
  // the Trip settings Dates row; this is the wizard's half of that decision.
  it("offers no way to type an end date", async () => {
    renderWizard();
    await user.type(screen.getByLabelText("Trip name"), "Japan");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByLabelText("Arrive")).toBeTruthy();
    expect(screen.queryByLabelText("Leave")).toBeNull();
  });

  it("can still create a trip from the name alone", async () => {
    const { createTrip } = renderWizard();
    await user.type(screen.getByLabelText("Trip name"), "Lisbon");
    await user.click(screen.getByRole("button", { name: "Create empty" }));

    expect(createTrip).toHaveBeenCalledWith({ name: "Lisbon" });
  });

  // Own coverage beyond the given block (per AGENTS.md's testing philosophy):

  it("renders Longer as an inert Preview badge that sets no day count", async () => {
    const { createTrip, dispatch } = renderWizard();
    createTrip.mockResolvedValue({ ok: true, value: { tripId: "trip-longer" } });

    await user.type(screen.getByLabelText("Trip name"), "Peru");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    // Preview shields pointer events, so this click is expected to be
    // rejected by userEvent's own pointer-events check — same pattern
    // preview.test.tsx uses to prove a wrapped control is truly inert.
    await user.click(screen.getByText("Longer")).catch(() => {});
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Create trip" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SetTripDates" }));
  });

  it("stages budget and currency locally and dispatches both at final submit", async () => {
    const { createTrip, dispatch } = renderWizard();
    createTrip.mockResolvedValue({ ok: true, value: { tripId: "trip-money" } });

    await user.type(screen.getByLabelText("Trip name"), "Nairobi");
    await user.click(screen.getByRole("button", { name: "Next" })); // Where -> When
    await user.click(screen.getByRole("button", { name: "Next" })); // When -> Who & Money
    // Currency first, then the amount: MoneyInput commits the currency it
    // was rendered with at blur time, so setting the amount after the
    // currency avoids staging a budget still tagged with the old currency.
    await user.selectOptions(screen.getByLabelText("Currency"), "EUR");
    await user.type(screen.getByLabelText("Total for the trip"), "2500");
    await user.click(screen.getByRole("button", { name: "Next" })); // -> Shape
    await user.click(screen.getByRole("button", { name: "Create trip" }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SetTripBudget",
          tripId: "trip-money",
          budget: { amountMinor: 250000, currency: "EUR" },
        }),
      ),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SetTripCurrency", tripId: "trip-money", currency: "EUR" }),
    );
  });

  it("dispatches nothing when creating an empty trip from the name alone", async () => {
    const { createTrip, dispatch } = renderWizard();
    createTrip.mockResolvedValue({ ok: true, value: { tripId: "trip-empty" } });

    await user.type(screen.getByLabelText("Trip name"), "Oslo");
    await user.click(screen.getByRole("button", { name: "Create empty" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalledWith({ name: "Oslo" }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("shows the create-trip error inline and keeps the sheet open on failure", async () => {
    const { createTrip, onOpenChange } = renderWizard();
    createTrip.mockResolvedValue({ ok: false, error: { status: 400, message: "name already taken" } });

    await user.type(screen.getByLabelText("Trip name"), "Iceland");
    await user.click(screen.getByRole("button", { name: "Create empty" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/name already taken/i);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  // Regression (CodeRabbit, PR #32): submit() used to fire every dates/
  // budget/currency dispatch without awaiting it, then navigate
  // unconditionally — a failed command was silently lost, no error, no
  // sign anything was wrong. Now each dispatch is awaited and checked
  // before the next one, and a failure stops there with an inline error
  // rather than navigating past it.
  it("surfaces a failed setup command inline and does not navigate", async () => {
    const { createTrip, dispatch, onCreated } = renderWizard();
    createTrip.mockResolvedValue({ ok: true, value: { tripId: "trip-fails-dates" } });
    dispatch.mockResolvedValueOnce({ ok: false, error: { status: 500, message: "server exploded" } });

    await user.type(screen.getByLabelText("Trip name"), "Prague");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "A week" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Create trip" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/server exploded/i);
    expect(onCreated).not.toHaveBeenCalled();
  });

  // The other half of the same fix: a failed setup command must not leave
  // a retry free to mint a second trip — createTrip only fires once across
  // both attempts, and the second attempt reuses the tripId the first one
  // already created.
  it("retrying after a failed setup command does not create a second trip", async () => {
    const { createTrip, dispatch } = renderWizard();
    createTrip.mockResolvedValue({ ok: true, value: { tripId: "trip-retry" } });
    dispatch.mockResolvedValueOnce({ ok: false, error: { status: 500, message: "server exploded" } });

    await user.type(screen.getByLabelText("Trip name"), "Prague");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "A week" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Create trip" }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SetTripDates", tripId: "trip-retry" }),
      ),
    );
    expect(createTrip).toHaveBeenCalledTimes(1);
  });

  // KI-2026-09-08-a: a transient failure on budget (a step AFTER dates) used
  // to be permanent, because the retry re-sent the already-applied
  // SetTripDates unconditionally. The real backend rejects a repeat of an
  // identical SetTripDates as a no-op (okUnlessNoOp, decide.ts), so this
  // dispatch stub reproduces that rule directly rather than trusting a mock
  // that would happily accept the same command twice.
  it("retrying after dates succeeded but budget failed does not re-send dates", async () => {
    const { createTrip, dispatch } = renderWizard();
    createTrip.mockResolvedValue({ ok: true, value: { tripId: "trip-retry-budget" } });

    let datesApplied: { startDate: string | null; endDate: string | null } | null = null;
    let budgetAttempts = 0;
    dispatch.mockImplementation(async (command) => {
      if (command.type === "SetTripDates") {
        if (
          datesApplied !== null &&
          datesApplied.startDate === command.startDate &&
          datesApplied.endDate === command.endDate
        ) {
          return { ok: false, error: { status: 409, message: "This change would have no effect." } };
        }
        datesApplied = { startDate: command.startDate, endDate: command.endDate };
        return { ok: true, value: {} as CommandOutcome };
      }
      if (command.type === "SetTripBudget") {
        budgetAttempts += 1;
        if (budgetAttempts === 1) {
          return { ok: false, error: { status: 500, message: "server exploded" } };
        }
        return { ok: true, value: {} as CommandOutcome };
      }
      return { ok: true, value: {} as CommandOutcome };
    });

    await user.type(screen.getByLabelText("Trip name"), "Prague");
    await user.click(screen.getByRole("button", { name: "Next" })); // Where -> When
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "A week" }));
    await user.click(screen.getByRole("button", { name: "Next" })); // When -> Who & Money
    await user.type(screen.getByLabelText("Total for the trip"), "500");
    await user.click(screen.getByRole("button", { name: "Next" })); // -> Shape
    await user.click(screen.getByRole("button", { name: "Create trip" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/server exploded/i);

    dispatch.mockClear();
    await user.click(screen.getByRole("button", { name: "Create trip" }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "SetTripBudget" })),
    );
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SetTripDates" }));
  });

  // CodeRabbit, PR #165. The latch above fixed re-sending a value that had
  // already landed. It did not cover the other direction: a field CLEARED
  // between attempts. Guarding the dates block on `ISO_DATE.test(arrive)`
  // skipped it entirely once `arrive` was emptied, so the retry kept dates the
  // user had just removed and reported success. Reachable because `Back` is
  // enabled whenever a submit is not in flight, which is exactly the state an
  // inline error leaves the sheet in.
  it("retrying after clearing the dates sends a clearing SetTripDates, not silence", async () => {
    const { createTrip, dispatch } = renderWizard();
    createTrip.mockResolvedValue({ ok: true, value: { tripId: "trip-clear-dates" } });

    let budgetAttempts = 0;
    dispatch.mockImplementation(async (command) => {
      if (command.type === "SetTripBudget") {
        budgetAttempts += 1;
        if (budgetAttempts === 1) return { ok: false, error: { status: 500, message: "server exploded" } };
      }
      return { ok: true, value: {} as CommandOutcome };
    });

    await user.type(screen.getByLabelText("Trip name"), "Porto");
    await user.click(screen.getByRole("button", { name: "Next" })); // Where -> When
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "A week" }));
    await user.click(screen.getByRole("button", { name: "Next" })); // When -> Who & Money
    await user.type(screen.getByLabelText("Total for the trip"), "500");
    await user.click(screen.getByRole("button", { name: "Next" })); // -> Shape
    await user.click(screen.getByRole("button", { name: "Create trip" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/server exploded/i);

    // Back to the dates step and remove them, the way a user correcting a
    // mistake mid-failure would.
    await user.click(screen.getByRole("button", { name: "Back" })); // Shape -> Who & Money
    await user.click(screen.getByRole("button", { name: "Back" })); // Who & Money -> When
    await user.clear(screen.getByLabelText("Arrive"));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    dispatch.mockClear();
    await user.click(screen.getByRole("button", { name: "Create trip" }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SetTripDates",
          tripId: "trip-clear-dates",
          startDate: null,
          endDate: null,
          newDayIds: [],
        }),
      ),
    );
  });

  // The same defect on the money half: `MoneyInput` emits null when cleared,
  // and `if (budget !== null)` skipped the block rather than clearing what had
  // already landed. `SetTripBudget.budget` is `Money.nullable()` — "null
  // clears" — so the command to send exists and was simply never sent.
  it("retrying after clearing the budget sends SetTripBudget with null, not silence", async () => {
    const { createTrip, dispatch } = renderWizard();
    createTrip.mockResolvedValue({ ok: true, value: { tripId: "trip-clear-budget" } });

    let currencyAttempts = 0;
    dispatch.mockImplementation(async (command) => {
      if (command.type === "SetTripCurrency") {
        currencyAttempts += 1;
        if (currencyAttempts === 1) return { ok: false, error: { status: 500, message: "currency exploded" } };
      }
      return { ok: true, value: {} as CommandOutcome };
    });

    await user.type(screen.getByLabelText("Trip name"), "Lisbon");
    await user.click(screen.getByRole("button", { name: "Next" })); // Where -> When
    await user.click(screen.getByRole("button", { name: "Next" })); // When -> Who & Money
    await user.selectOptions(screen.getByLabelText("Currency"), "EUR");
    await user.type(screen.getByLabelText("Total for the trip"), "2500");
    await user.click(screen.getByRole("button", { name: "Next" })); // -> Shape
    await user.click(screen.getByRole("button", { name: "Create trip" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/currency exploded/i);

    await user.click(screen.getByRole("button", { name: "Back" })); // Shape -> Who & Money
    await user.clear(screen.getByLabelText("Total for the trip"));
    await user.click(screen.getByRole("button", { name: "Next" }));

    dispatch.mockClear();
    await user.click(screen.getByRole("button", { name: "Create trip" }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SetTripBudget", tripId: "trip-clear-budget", budget: null }),
      ),
    );
  });
});
