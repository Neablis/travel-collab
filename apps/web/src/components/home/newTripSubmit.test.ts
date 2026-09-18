import { describe, expect, it, vi } from "vitest";
import type { ApiResult, BoardCommand, CommandOutcome } from "@/lib/apiClient";
import { createTripWithSetup, type TripSetup } from "./newTripSubmit";

// THE RETRY LATCH, tested where it lives.
//
// These four cases were `NewTripWizard.test.tsx`'s regression cover for
// CodeRabbit PR #32, KI-2026-09-08-a and CodeRabbit PR #165. They drove the
// latch by typing into the budget and currency fields and clicking Next three
// times — and the four-turn script has no turn for budget or currency, so the
// form they depended on is gone.
//
// Ported rather than deleted, and they get STRONGER in the move: "the user
// clicks Back and clears the field" becomes "pass a different setup", which is
// what the step was standing in for, and the sequence no longer has to be
// reached through four clicks to be exercised at all.
const ok = <T,>(value: T): ApiResult<T> => ({ ok: true, value });
const fail = (message: string, status = 500): ApiResult<never> => ({
  ok: false,
  error: { status, message },
});

const SETUP: TripSetup = {
  name: "Prague",
  arrive: "2026-10-03",
  days: 7,
  budget: null,
  currency: "USD",
};

/** `newTripId` is bound to the same id the stub echoes, because the client
 *  mints it now (KI-2026-09-12-e) and the server confirms it rather than
 *  choosing it. A test that let them differ would be testing a server that
 *  does not exist. */
function stubs(tripId: string) {
  const createTrip = vi.fn(async (input: { name: string; tripId?: string }) =>
    ok({ tripId: input.tripId ?? tripId }),
  );
  const dispatch = vi.fn(async () => ok({} as CommandOutcome));
  return { createTrip, dispatch, newTripId: () => tripId };
}

/** Deterministic day ids: `crypto.randomUUID` works in this lane, but a test
 *  that asserts on the ids should not depend on which ones it got. */
function countingDayId() {
  let n = 0;
  return () => `day-${(n += 1)}`;
}

describe("createTripWithSetup", () => {
  it("creates with the name alone when nothing is to be applied", async () => {
    const { createTrip, dispatch, newTripId } = stubs("trip-empty");
    const result = await createTripWithSetup({
      setup: SETUP,
      applySetup: false,
      latch: null,
      createTrip,
      dispatch,
      newTripId,
    });

    expect(result.ok).toBe(true);
    expect(createTrip).toHaveBeenCalledWith(expect.objectContaining({ name: "Prague" }));
    // "Create empty" is the escape hatch, and it dispatches nothing at all —
    // not even the dates the wizard happens to be holding.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("trims the name, and refuses a blank one without creating anything", async () => {
    const { createTrip, dispatch, newTripId } = stubs("trip-blank");
    await createTripWithSetup({
      setup: { ...SETUP, name: "  Prague  " },
      applySetup: false,
      latch: null,
      createTrip,
      dispatch,
      newTripId,
    });
    expect(createTrip).toHaveBeenCalledWith(expect.objectContaining({ name: "Prague" }));

    createTrip.mockClear();
    const blank = await createTripWithSetup({
      setup: { ...SETUP, name: "   " },
      applySetup: false,
      latch: null,
      createTrip,
      dispatch,
      newTripId,
    });
    expect(blank.ok).toBe(false);
    // `CreateTrip.name` is `z.string().min(1)`: a trip with no name is a
    // request the domain would reject, so it is never sent.
    expect(createTrip).not.toHaveBeenCalled();
  });

  it("applies dates as an inclusive span, one day id per day", async () => {
    const { createTrip, dispatch, newTripId } = stubs("trip-dates");
    await createTripWithSetup({
      setup: SETUP,
      applySetup: true,
      latch: null,
      createTrip,
      dispatch,
      newTripId,
      newDayId: countingDayId(),
    });

    // Seven days from the 3rd ends on the 9th, not the 10th.
    expect(dispatch).toHaveBeenCalledWith({
      type: "SetTripDates",
      tripId: "trip-dates",
      startDate: "2026-10-03",
      endDate: "2026-10-09",
      newDayIds: ["day-1", "day-2", "day-3", "day-4", "day-5", "day-6", "day-7"],
    });
  });

  it("sends no dates command when there is no arrival to anchor them to", async () => {
    const { createTrip, dispatch, newTripId } = stubs("trip-undated");
    await createTripWithSetup({
      setup: { ...SETUP, arrive: "" },
      applySetup: true,
      latch: null,
      createTrip,
      dispatch,
      newTripId,
    });
    // A length with no arrival is not a dated trip, and a trip created moments
    // ago already has no dates — so there is nothing to clear either.
    expect(dispatch).not.toHaveBeenCalled();
  });

  // Regression (CodeRabbit, PR #32): this used to fire every dates/budget/
  // currency dispatch without awaiting it and report success regardless — a
  // failed command was silently lost.
  it("stops at a failed command and says which one, without claiming success", async () => {
    const { createTrip, dispatch, newTripId } = stubs("trip-fails-dates");
    dispatch.mockResolvedValueOnce(fail("server exploded"));

    const result = await createTripWithSetup({
      setup: { ...SETUP, budget: { amountMinor: 50000, currency: "USD" } },
      applySetup: true,
      latch: null,
      createTrip,
      dispatch,
      newTripId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/server exploded/i);
    expect(result.error).toMatch(/setting dates failed/i);
    // It stopped: the budget after it was never attempted.
    expect(dispatch).toHaveBeenCalledTimes(1);
    // And the trip is real, so the caller must not create a second one.
    expect(result.latch?.tripId).toBe("trip-fails-dates");
  });

  it("reuses the trip a failed attempt already created, rather than minting a second", async () => {
    const { createTrip, dispatch, newTripId } = stubs("trip-retry");
    dispatch.mockResolvedValueOnce(fail("server exploded"));

    const first = await createTripWithSetup({
      setup: SETUP,
      applySetup: true,
      latch: null,
      createTrip,
      dispatch,
      newTripId,
    });
    expect(first.ok).toBe(false);

    await createTripWithSetup({
      setup: SETUP,
      applySetup: true,
      latch: first.latch,
      createTrip,
      dispatch,
      newTripId,
    });

    expect(createTrip).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "SetTripDates", tripId: "trip-retry" }),
    );
  });

  // KI-2026-09-08-a. A transient failure on budget — a step AFTER dates — used
  // to be permanent, because the retry re-sent the already-applied
  // SetTripDates unconditionally and the domain rejects an identical repeat as
  // a no-op. The stub reproduces that rule rather than trusting a mock that
  // would happily accept the same command twice.
  it("does not re-send dates that already landed when a later command failed", async () => {
    const createTrip = vi.fn(async () => ok({ tripId: "trip-retry-budget" }));
    let datesApplied: { startDate: string | null; endDate: string | null } | null = null;
    let budgetAttempts = 0;
    const dispatch = vi.fn(async (command: BoardCommand): Promise<ApiResult<CommandOutcome>> => {
      if (command.type === "SetTripDates") {
        if (
          datesApplied !== null &&
          datesApplied.startDate === command.startDate &&
          datesApplied.endDate === command.endDate
        ) {
          return fail("This change would have no effect.", 409);
        }
        datesApplied = { startDate: command.startDate, endDate: command.endDate };
        return ok({} as CommandOutcome);
      }
      if (command.type === "SetTripBudget") {
        budgetAttempts += 1;
        if (budgetAttempts === 1) return fail("server exploded");
      }
      return ok({} as CommandOutcome);
    });

    const withBudget: TripSetup = { ...SETUP, budget: { amountMinor: 50000, currency: "USD" } };
    const first = await createTripWithSetup({
      setup: withBudget,
      applySetup: true,
      latch: null,
      createTrip,
      dispatch,
    });
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("unreachable");
    expect(first.error).toMatch(/server exploded/i);

    dispatch.mockClear();
    const second = await createTripWithSetup({
      setup: withBudget,
      applySetup: true,
      latch: first.latch,
      createTrip,
      dispatch,
    });

    expect(second.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "SetTripBudget" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SetTripDates" }));
  });

  // CodeRabbit, PR #165. The latch above fixed re-sending a value that had
  // already landed; it did not cover a field CLEARED between attempts.
  // Guarding the dates block on `ISO_DATE.test(arrive)` alone skipped it
  // entirely once `arrive` was emptied, so the retry kept dates the user had
  // just removed and reported success.
  it("sends a clearing SetTripDates when the dates were removed between attempts", async () => {
    const createTrip = vi.fn(async () => ok({ tripId: "trip-clear-dates" }));
    let budgetAttempts = 0;
    const dispatch = vi.fn(async (command: BoardCommand): Promise<ApiResult<CommandOutcome>> => {
      if (command.type === "SetTripBudget") {
        budgetAttempts += 1;
        if (budgetAttempts === 1) return fail("server exploded");
      }
      return ok({} as CommandOutcome);
    });

    const withBudget: TripSetup = { ...SETUP, budget: { amountMinor: 50000, currency: "USD" } };
    const first = await createTripWithSetup({
      setup: withBudget,
      applySetup: true,
      latch: null,
      createTrip,
      dispatch,
      newTripId: () => "trip-clear-dates",
    });
    expect(first.ok).toBe(false);

    dispatch.mockClear();
    await createTripWithSetup({
      // The dates removed, the way a person correcting a mistake mid-failure
      // would — the step the old test spent two "Back" clicks reaching.
      setup: { ...withBudget, arrive: "" },
      applySetup: true,
      latch: first.latch,
      createTrip,
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "SetTripDates",
      tripId: "trip-clear-dates",
      startDate: null,
      endDate: null,
      newDayIds: [],
    });
  });

  // The same defect on the money half: `SetTripBudget.budget` is
  // `Money.nullable()` — "null clears" — so the command to send exists and was
  // simply never sent.
  it("sends SetTripBudget with null when the budget was cleared between attempts", async () => {
    const createTrip = vi.fn(async () => ok({ tripId: "trip-clear-budget" }));
    let currencyAttempts = 0;
    const dispatch = vi.fn(async (command: BoardCommand): Promise<ApiResult<CommandOutcome>> => {
      if (command.type === "SetTripCurrency") {
        currencyAttempts += 1;
        if (currencyAttempts === 1) return fail("currency exploded");
      }
      return ok({} as CommandOutcome);
    });

    const staged: TripSetup = {
      ...SETUP,
      arrive: "",
      budget: { amountMinor: 250000, currency: "EUR" },
      currency: "EUR",
    };
    const first = await createTripWithSetup({
      setup: staged,
      applySetup: true,
      latch: null,
      createTrip,
      dispatch,
      newTripId: () => "trip-clear-budget",
    });
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("unreachable");
    expect(first.error).toMatch(/currency exploded/i);

    dispatch.mockClear();
    await createTripWithSetup({
      setup: { ...staged, budget: null },
      applySetup: true,
      latch: first.latch,
      createTrip,
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "SetTripBudget",
      tripId: "trip-clear-budget",
      budget: null,
    });
  });

  // KI-2026-09-12-e. The retry was safe against a REJECTED command and not
  // against a LOST RESPONSE: the command committed, the browser lost the reply,
  // `createTrip` returned ok:false, the latch never received the tripId, and
  // the retry minted a second trip. D-D, answered 2026-09-16: an idempotency
  // key, not a read-back reconcile — read-back costs a round trip on every
  // retry and needs a list-and-match heuristic on a name that is not unique.
  describe("a lost response", () => {
    it("sends an id it minted, so the retry is the same command", async () => {
      const { createTrip, dispatch } = stubs("ignored-server-id");
      await createTripWithSetup({
        setup: SETUP,
        applySetup: false,
        latch: null,
        createTrip,
        dispatch,
        newTripId: () => "mine-1",
      });
      expect(createTrip).toHaveBeenCalledWith({ name: "Prague", tripId: "mine-1" });
    });

    it("uses the id it minted, not the one the server echoed", async () => {
      // They agree in practice. They must agree in CODE too: reading the
      // server's echo is what leaves the retry with nothing when the response
      // is the thing that went missing.
      const createTrip = vi.fn(async () => ok({ tripId: "server-said-something-else" }));
      const dispatch = vi.fn(async () => ok({} as CommandOutcome));
      const result = await createTripWithSetup({
        setup: SETUP,
        applySetup: false,
        latch: null,
        createTrip,
        dispatch,
        newTripId: () => "mine-2",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.latch.tripId).toBe("mine-2");
    });

    it("reads trip-already-exists as landed, not as a failure", async () => {
      const createTrip = vi.fn(async (): Promise<ApiResult<{ tripId: string }>> => ({
        ok: false,
        error: {
          status: 400,
          message: "A trip with this id already exists.",
          code: "trip-already-exists",
        },
      }));
      const dispatch = vi.fn(async () => ok({} as CommandOutcome));

      const result = await createTripWithSetup({
        setup: SETUP,
        applySetup: true,
        latch: null,
        createTrip,
        dispatch,
        newTripId: () => "mine-3",
      });

      // The trip is there, under the id we chose — so the sequence carries on
      // and applies the setup rather than reporting a problem that has gone.
      expect(result.ok).toBe(true);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SetTripDates", tripId: "mine-3" }),
      );
    });

    it("still reports a create that really failed", async () => {
      const createTrip = vi.fn(async (): Promise<ApiResult<{ tripId: string }>> => ({
        ok: false,
        error: { status: 500, message: "server exploded" },
      }));
      const dispatch = vi.fn(async () => ok({} as CommandOutcome));

      const result = await createTripWithSetup({
        setup: SETUP,
        applySetup: true,
        latch: null,
        createTrip,
        dispatch,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toMatch(/server exploded/i);
      // No trip, so no latch — the one case where it is legitimately null.
      expect(result.latch).toBeNull();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  it("sends no currency command for the default, and one for anything else", async () => {
    const { createTrip, dispatch, newTripId } = stubs("trip-currency");
    await createTripWithSetup({
      setup: { ...SETUP, arrive: "" },
      applySetup: true,
      latch: null,
      createTrip,
      dispatch,
      newTripId,
    });
    // A fresh trip is already USD — unlike dates and budget there is no
    // "clear" here, so the default is silence rather than a command.
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SetTripCurrency" }));

    await createTripWithSetup({
      setup: { ...SETUP, arrive: "", currency: "JPY" },
      applySetup: true,
      latch: null,
      createTrip,
      dispatch,
      newTripId,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SetTripCurrency", currency: "JPY" }),
    );
  });
});
