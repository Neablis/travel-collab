import type { Money } from "@tc/contracts";
import type { ApiResult, BoardCommand, CommandOutcome } from "@/lib/apiClient";
import { addDaysIso } from "@/lib/dates";

/**
 * **Create a trip, then apply what the wizard staged for it — as one sequence
 * that can be retried without doing anything twice.**
 *
 * This was `WizardBody.submit()` and it moved out here when the four-turn
 * script replaced the four-step form. The move is not tidiness: the regression
 * cover for **KI-2026-09-08-a** drove this logic through the budget and
 * currency fields, and the four-turn script has no turn for either. Left where
 * it was, the choice would have been to delete the tests guarding a closed
 * known issue, or to keep a budget form in a flow with no place for one. Tested
 * directly, the latch stops being reachable only through four clicks, and the
 * branches survive for whichever plan reintroduces the fields.
 *
 * **Nothing in here is React.** It takes what it needs and returns what
 * happened, so the caller owns every piece of state it used to set.
 */

/** A native `<input type="date">`'s `value` is spec'd to be either "" or a
 *  complete valid date, but was observed (manual verification, Phase 7) to be
 *  mid-edit — e.g. typing month/day/year one keystroke at a time — so `arrive`
 *  arrives here as an intermediate value before it settles. Same shape as
 *  `packages/contracts/src/trip.ts`'s private ISO_DATE; UI cannot import that
 *  (module map, AGENTS.md), and this is a plain regex literal, not domain
 *  logic. Every date call below is gated on it first: `addDaysIso` throws on an
 *  incomplete value rather than returning garbage. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What the wizard collected. `days` is a count, not an end date — inclusive
 *  arithmetic lives in one place, below, so N days from A ends at A + (N-1). */
export interface TripSetup {
  name: string;
  arrive: string;
  days: number | null;
  budget: Money | null;
  currency: string;
}

/**
 * **What has already landed**, carried across attempts.
 *
 * The tripId alone answers *"don't create a second trip"* but not *"don't
 * re-send a command that already landed"*. A retry that blindly re-sends
 * `SetTripDates` with the same start/end is rejected by the domain as a no-op
 * (`okUnlessNoOp`, `decide.ts`), which turned a transient failure on budget or
 * currency — the steps AFTER dates — into a permanent one: every retry
 * re-failed at dates, and the error blamed dates even though dates had already
 * succeeded. That is KI-2026-09-08-a.
 *
 * Each field stores the applied VALUE rather than a boolean, so changing a
 * field before retrying still re-sends it.
 */
export interface SetupLatch {
  tripId: string;
  datedAs: { startDate: string; endDate: string } | null;
  budgetAppliedAs: Money | null;
  currencyAppliedAs: string | null;
}

/**
 * `latch` comes back on **both** outcomes, and on the failure it is the half
 * that did land. A caller that dropped it on failure would re-send the
 * commands that had already succeeded, which is the whole defect above.
 * It is `null` only when `createTrip` itself failed and there is no trip.
 */
export type SetupResult =
  | { ok: true; latch: SetupLatch }
  | { ok: false; error: string; latch: SetupLatch | null };

export const DEFAULT_CURRENCY = "USD";

export async function createTripWithSetup({
  setup,
  applySetup,
  latch,
  createTrip,
  dispatch,
  newDayId = () => crypto.randomUUID(),
}: {
  setup: TripSetup;
  /** False for "Create empty": the name, and nothing else. */
  applySetup: boolean;
  /** What a previous attempt got through, or `null` on the first. */
  latch: SetupLatch | null;
  createTrip: (input: { name: string }) => Promise<ApiResult<{ tripId: string }>>;
  /**
   * Awaited, not fire-and-forget (CodeRabbit, PR #32): each command confirms —
   * or reports a real failure — before the next is sent, rather than racing an
   * in-flight `SetTripDates` against the trip page's own first load.
   */
  dispatch: (command: BoardCommand) => Promise<ApiResult<CommandOutcome>>;
  /** Injectable so a test can read the ids it produced. */
  newDayId?: () => string;
}): Promise<SetupResult> {
  const name = setup.name.trim();
  if (name === "") return { ok: false, error: "A trip needs a name.", latch };

  let applied = latch;
  if (applied === null) {
    const result = await createTrip({ name });
    if (!result || !result.ok) {
      return { ok: false, error: result?.error?.message ?? "Something went wrong", latch: null };
    }
    applied = {
      tripId: result.value.tripId,
      datedAs: null,
      budgetAppliedAs: null,
      currencyAppliedAs: null,
    };
  }
  const tripId = applied.tripId;
  if (!applySetup) return { ok: true, latch: applied };

  // **Dates.** What the form says NOW, which may be null because the field was
  // cleared between attempts (CodeRabbit, PR #165). Comparing a nullable
  // desired value against what is latched is the whole point: guarding on
  // `ISO_DATE.test(arrive)` alone skipped this block entirely when `arrive` was
  // emptied, so a retry silently kept dates the user had just removed and
  // reported success. Both commands take the null — `SetTripDates` is
  // start/end nullable with `newDayIds: []`, and `SetTripBudget.budget` is
  // `Money.nullable()`. "Null clears."
  const desiredDates =
    ISO_DATE.test(setup.arrive) && setup.days !== null
      ? { startDate: setup.arrive, endDate: addDaysIso(setup.arrive, setup.days - 1) }
      : null;
  // A clear is only worth sending if this wizard actually set something
  // earlier — a trip created moments ago already has no dates, and asking the
  // domain to clear nothing is the no-op rejection this latch exists to avoid.
  const datesDiffer =
    desiredDates === null
      ? applied.datedAs !== null
      : applied.datedAs === null ||
        applied.datedAs.startDate !== desiredDates.startDate ||
        applied.datedAs.endDate !== desiredDates.endDate;
  if (datesDiffer) {
    const newDayIds =
      desiredDates === null || setup.days === null
        ? []
        : Array.from({ length: setup.days }, () => newDayId());
    const result = await dispatch({
      type: "SetTripDates",
      tripId,
      startDate: desiredDates?.startDate ?? null,
      endDate: desiredDates?.endDate ?? null,
      newDayIds,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: `Trip created, but setting dates failed: ${result.error.message}. Try again.`,
        latch: applied,
      };
    }
    applied = { ...applied, datedAs: desiredDates };
  }

  // **Budget**, on the same nullable-compare rule as dates.
  const budget = setup.budget;
  const budgetApplied = applied.budgetAppliedAs;
  const budgetDiffers =
    budget === null
      ? budgetApplied !== null
      : budgetApplied === null ||
        budgetApplied.amountMinor !== budget.amountMinor ||
        budgetApplied.currency !== budget.currency;
  if (budgetDiffers) {
    const result = await dispatch({ type: "SetTripBudget", tripId, budget });
    if (!result.ok) {
      return {
        ok: false,
        error: `Trip created, but setting the budget failed: ${result.error.message}. Try again.`,
        latch: applied,
      };
    }
    applied = { ...applied, budgetAppliedAs: budget };
  }

  // **Currency.** A fresh trip is already `USD`, so the default needs no
  // command at all — unlike dates and budget, there is no "clear" here.
  if (setup.currency !== DEFAULT_CURRENCY && applied.currencyAppliedAs !== setup.currency) {
    const result = await dispatch({ type: "SetTripCurrency", tripId, currency: setup.currency });
    if (!result.ok) {
      return {
        ok: false,
        error: `Trip created, but setting the currency failed: ${result.error.message}. Try again.`,
        latch: applied,
      };
    }
    applied = { ...applied, currencyAppliedAs: setup.currency };
  }

  return { ok: true, latch: applied };
}
