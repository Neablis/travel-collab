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
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What the wizard collected. `days` is a count, not an end date — inclusive
 *  arithmetic lives in one place, below, so N days from A ends at A + (N-1). */
export interface TripSetup {
  name: string;
  arrive: string;
  days: number | null;
  budget: Money | null;
  currency: string;
  /** Published days the Playbook-day turn chose (M27 D13), with how many
   *  days each one appends. Optional: every caller before that turn existed
   *  sends none. */
  savedDays?: readonly { savedDayId: string; dayCount: number }[];
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
  /** `endDate` is null when the chosen days fill the whole length, and the
   *  dates command set only the start. */
  datedAs: { startDate: string; endDate: string | null } | null;
  budgetAppliedAs: Money | null;
  currencyAppliedAs: string | null;
  /**
   * The chosen days that are in the trip, so a retry does not insert one a
   * second time — an insert appends a whole new day, and is not a no-op the
   * domain would refuse. Optional so a latch written before M27 still reads.
   */
  insertedDays?: readonly string[];
}

/**
 * `latch` comes back on **both** outcomes, and on the failure it is the half
 * that did land. A caller that dropped it on failure would re-send the
 * commands that had already succeeded, which is the whole defect above.
 * It is `null` only when `createTrip` itself failed and there is no trip.
 */
export type SetupResult =
  | {
      ok: true;
      latch: SetupLatch;
      /**
       * Chosen days that could not be inserted. **Not a failure of the
       * setup:** the trip exists, is dated and is usable, and a day that did
       * not land can be added from Playbooks — so the caller says which, in
       * its closing line, rather than holding the trip back over it.
       */
      missedDays: readonly string[];
      /**
       * How many days the trip has, when this laid them out: the empty ones
       * plus every chosen day in it. `null` for a trip it gave no dates, whose
       * length it did not set.
       */
      dayCount: number | null;
    }
  | { ok: false; error: string; latch: SetupLatch | null };

export const DEFAULT_CURRENCY = "USD";

export async function createTripWithSetup({
  setup,
  applySetup,
  latch,
  createTrip,
  dispatch,
  insertDay,
  newDayId = () => crypto.randomUUID(),
  newTripId = () => crypto.randomUUID(),
}: {
  setup: TripSetup;
  /** False for "Create empty": the name, and nothing else. */
  applySetup: boolean;
  /** What a previous attempt got through, or `null` on the first. */
  latch: SetupLatch | null;
  createTrip: (input: { name: string; tripId?: string }) => Promise<ApiResult<{ tripId: string }>>;
  /**
   * Awaited, not fire-and-forget (CodeRabbit, PR #32): each command confirms —
   * or reports a real failure — before the next is sent, rather than racing an
   * in-flight `SetTripDates` against the trip page's own first load.
   */
  dispatch: (command: BoardCommand) => Promise<ApiResult<CommandOutcome>>;
  /**
   * Puts one chosen published day into the trip —
   * `POST /api/trips/:id/saved-days/:savedDayId`, the same door the manual
   * "Add to a trip" uses. Absent means no day can be inserted, and any chosen
   * one is reported as missed rather than silently forgotten.
   */
  insertDay?: (tripId: string, savedDayId: string) => Promise<ApiResult<CommandOutcome>>;
  /** Injectable so a test can read the ids it produced. */
  newDayId?: () => string;
  /** The same, for the trip's own id — see the retry note below. */
  newTripId?: () => string;
}): Promise<SetupResult> {
  const name = setup.name.trim();
  if (name === "") return { ok: false, error: "A trip needs a name.", latch };

  let applied = latch;
  if (applied === null) {
    // **The id is minted HERE, not by the server** (KI-2026-09-12-e). The
    // wizard's retry was safe against a rejected command and not against a LOST
    // RESPONSE: if `CreateTrip` committed and the browser lost the reply, this
    // returned `ok: false`, the latch never got the tripId, and retrying minted
    // a second trip. Sending the id makes the retry the same command.
    const tripId = newTripId();
    const result = await createTrip({ name, tripId });
    if (!result || !result.ok) {
      // **`trip-already-exists` means the first attempt LANDED.** The domain
      // answers it from `decideCreateTrip`, and it is the one "failure" that is
      // really a success — the trip is there, under the id we chose. Treating
      // it as an error is what left a retry reporting a problem that no longer
      // existed.
      if (result?.error?.code !== "trip-already-exists") {
        return { ok: false, error: result?.error?.message ?? "Something went wrong", latch: null };
      }
    }
    applied = {
      tripId,
      datedAs: null,
      budgetAppliedAs: null,
      currencyAppliedAs: null,
    };
  }
  const tripId = applied.tripId;
  if (!applySetup) return { ok: true, latch: applied, missedDays: [], dayCount: null };

  // **Dates.** What the form says NOW, which may be null because the field was
  // cleared between attempts (CodeRabbit, PR #165). Comparing a nullable
  // desired value against what is latched is the whole point: guarding on
  // `ISO_DATE.test(arrive)` alone skipped this block entirely when `arrive` was
  // emptied, so a retry silently kept dates the user had just removed and
  // reported success. Both commands take the null — `SetTripDates` is
  // start/end nullable with `newDayIds: []`, and `SetTripBudget.budget` is
  // `Money.nullable()`. "Null clears."
  //
  // **Only the days the chosen Playbook days do not fill** (M27 D13). Each
  // insert below APPENDS its days, so laying out the whole answered length
  // first made "5 days" plus a 1-day and a 3-day Playbook a 9-day trip. When
  // the chosen days run longer than the answer, they are the trip: the end is
  // null, which sets the start and leaves the day count alone.
  const chosenLength = (setup.savedDays ?? []).reduce((sum, day) => sum + day.dayCount, 0);
  const emptyDays = setup.days === null ? 0 : Math.max(setup.days - chosenLength, 0);
  const desiredDates =
    ISO_DATE.test(setup.arrive) && setup.days !== null
      ? { startDate: setup.arrive, endDate: emptyDays === 0 ? null : addDaysIso(setup.arrive, emptyDays - 1) }
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
    const newDayIds = desiredDates === null ? [] : Array.from({ length: emptyDays }, () => newDayId());
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

  // **The chosen Playbook days, last** (M27 D13). After the dates on purpose:
  // `SetTripDates` reconciles the day count to its range, so sent second it
  // would remove the days just inserted. (Not for the adds ledger: `addCounts`
  // asks only whether the adder wrote the day, and an add into an undated trip
  // counts — the dates clause was dropped on 2026-09-08, `savedDayAdds.ts`.)
  // One insert per day, each its own undoable batch, exactly as the manual
  // "Add to a trip" makes it.
  //
  // **A failed insert does not fail the setup.** Everything the reader asked
  // the trip to BE has landed by now; a day that did not is one they can add
  // from Playbooks, and holding the whole trip back over it — or reporting
  // "Trip created, but…" with a retry that re-sends nothing useful — would
  // cost more than it saves. It is reported, not lost.
  const missedDays: string[] = [];
  for (const { savedDayId } of setup.savedDays ?? []) {
    if (applied.insertedDays?.includes(savedDayId)) continue;
    const result = insertDay === undefined ? null : await insertDay(tripId, savedDayId);
    if (result === null || !result.ok) {
      missedDays.push(savedDayId);
      continue;
    }
    applied = { ...applied, insertedDays: [...(applied.insertedDays ?? []), savedDayId] };
  }

  const inserted = applied.insertedDays ?? [];
  const placedLength = (setup.savedDays ?? [])
    .filter((day) => inserted.includes(day.savedDayId))
    .reduce((sum, day) => sum + day.dayCount, 0);
  const dayCount = applied.datedAs === null ? null : emptyDays + placedLength;
  return { ok: true, latch: applied, missedDays, dayCount };
}
