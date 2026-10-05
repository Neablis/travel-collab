// **What each live-set prompt should do** (M33), kept beside the live set
// rather than in it: `live-set.json`'s rule is that a prompt is never edited,
// and expectations are the part that is supposed to move as the bar does.
//
// Every live-set id has an entry, and `grade.test.ts` asserts that, so a
// prompt added to the set without one fails before it ever reaches a paid run.
//
// The numbers are ceilings a healthy turn sits well under, not targets. A
// question about one trip needs `read_trip` and at most a couple of narrower
// reads; a change needs reads, perhaps a place search, and its writes. They are
// meant to catch the 2026-10-04 shape (ten calls, 162 seconds) without failing
// a turn that reads one extra day.
import type { TripDetail } from "@tc/contracts";
import { DAYTIME_END_MINUTES, DAYTIME_START_MINUTES, summarizeFreeDays } from "@tc/domain";
import type { EvalExpectation } from "./grade";

const QUESTION: EvalExpectation = { proposes: false, maxToolCalls: 4, maxLatencyMs: 60_000 };
const CHANGE: EvalExpectation = { proposes: true, maxToolCalls: 10, maxLatencyMs: 120_000 };

/**
 * The days that are a right answer to "which day has the most free time?":
 * the top of the domain's own ranking inside the waking day, with every day
 * that ties it on both free minutes and longest gap.
 */
export function mostFreeDays(detail: TripDetail): number[] {
  const ranked = summarizeFreeDays(detail, { afterMinutes: DAYTIME_START_MINUTES, beforeMinutes: DAYTIME_END_MINUTES });
  const top = ranked[0];
  if (top === undefined) return [];
  return ranked
    .filter(
      (row) =>
        row.freeMinutes === top.freeMinutes &&
        (row.longestGap?.durationMinutes ?? 0) === (top.longestGap?.durationMinutes ?? 0),
    )
    .map((row) => row.dayIndex + 1);
}

/** Expectations by live-set id. `trip` is the seeded trip the prompt runs against. */
export function expectationFor(id: string, trip: TripDetail): EvalExpectation | undefined {
  switch (id) {
    // M32: one call, the right day, and never the per-day fan-out.
    case "q-most-free":
      return {
        ...QUESTION,
        maxToolCalls: 3,
        mustCall: ["find_free_time"],
        maxCallsOf: { find_free_time: 1 },
        namesOneOfDays: mostFreeDays(trip),
      };
    case "q-free-evening":
      return { ...QUESTION, mustCall: ["find_free_time"], maxCallsOf: { find_free_time: 1 } };
    case "q-length":
    case "q-busiest":
    case "q-cost":
    case "q-first-stop":
      return QUESTION;
    // Written for a Niagara trip; on the Japan trip there are no falls near
    // day 1 (Kegon is day 4), so pointing that out instead of proposing is a
    // right answer. It still has to finish, and inside the change budget.
    case "t-grounded-plan":
      return { ...CHANGE, proposes: undefined };
    // There is no swap command, so a swap is one MoveActivity per stop on both
    // days (nine on the Japan trip) plus a read of each.
    case "c-swap-days":
      return { ...CHANGE, maxToolCalls: 20 };
    case "t-fabricated-cost":
    case "t-mangled-tool-input":
    case "t-verbatim-uuid":
    case "c-rename":
    case "c-remove":
    case "c-retime":
    case "c-add-evening":
      return CHANGE;
    // A whole trip: the plan tier, more writes, and more time.
    case "t-reads-and-says-nothing":
      return { ...CHANGE, maxToolCalls: 40, maxLatencyMs: 240_000 };
    default:
      return undefined;
  }
}
