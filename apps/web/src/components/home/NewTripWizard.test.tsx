import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, BoardCommand } from "@/lib/apiClient";
import { NewTripWizard } from "./NewTripWizard";

afterEach(cleanup);

const user = userEvent.setup({ delay: null });

function renderWizard() {
  const createTrip = vi.fn<(input: { name: string }) => Promise<ApiResult<{ tripId: string }>>>();
  const dispatch = vi.fn<(command: BoardCommand) => void>();
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
});
