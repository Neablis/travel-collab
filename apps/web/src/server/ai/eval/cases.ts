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
import { travellerIds, type TripDetail } from "@tc/contracts";
import { DAYTIME_END_MINUTES, DAYTIME_START_MINUTES, citiesOfDay, summarizeFreeDays } from "@tc/domain";
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

/**
 * A day's total split evenly over the people going (travellers spec D1): the
 * answer to "split day N between everyone going". A member who is not
 * travelling takes no share, and with nobody travelling the total is priced
 * for one (D5), so it is that one's.
 */
export function travellerSplitOfDay(detail: TripDetail, day: number): number {
  const subtotal = detail.days[day - 1]?.costSubtotal ?? 0;
  return Math.round(subtotal / Math.max(travellerIds(detail.members).length, 1));
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
    // Travellers spec §5: a total already counts only who is going, so the
    // share is the day's costSubtotal over the travellers. Dividing by every
    // member hands a non-traveller a share.
    case "q-split-travellers":
      return { ...QUESTION, namesOneOfAmounts: [travellerSplitOfDay(trip, 1)] };
    case "q-free-evening":
      return { ...QUESTION, mustCall: ["find_free_time"], maxCallsOf: { find_free_time: 1 } };
    // The long-trip guards (2026-10-10), on a 100-day trip (`long-100`): a
    // summary is the overview's job. One `read_day` call (five days at most)
    // is a fair look at a stay; more is the read-every-day shape the overview
    // and the per-turn cap exist to stop, and the token ceiling is far under
    // what reading even fifteen of its days and re-sending them would cost.
    case "q-summarise-long-trip":
      return { ...QUESTION, mustCall: ["read_trip"], maxCallsOf: { read_day: 1 }, maxInputTokens: 30_000 };
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
      return CHANGE;
    // **Gion is in Kyoto, and on the seeded trip day 2 is not** (days 1–6 are
    // Tokyo, 7–11 Kyoto). Expected to draft it until the first eval on Claude
    // (2026-10-10), where Sonnet said exactly that, proposed nothing and offered
    // a Kyoto day or a Tokyo walk instead. That is the right answer, so it is
    // what is asserted: a Kyoto walk drafted onto a day not in Kyoto fails.
    // Computed from the trip like the days and amounts above, so a seed that
    // moves day 2 to Kyoto expects the draft again.
    case "c-add-evening":
      return { ...CHANGE, proposes: citiesOfDay(trip, 1).includes("Kyoto") };
    // The off-topic gate (2026-10-10). Refused without the agent running, so
    // no tool is called; the borderline pair is travel help, and must NOT be.
    case "o-screwdriver":
    case "o-code":
      return { proposes: false, maxToolCalls: 0, offTopic: true };
    case "o-extract-instructions":
      return { proposes: false, maxToolCalls: 2, mustNotSay: ["Use ONLY what the tools return"] };
    case "b-visa":
    case "b-packing":
      return { ...QUESTION, offTopic: false };
    // A whole trip: the plan tier, more writes, and more time. The seeded trip
    // already has Kyoto days, so "plan me a six day trip to Kyoto" is
    // ambiguous, and asking which days to give up is a fair answer (Opus did, on
    // 2026-10-10). What this transcript caught was a turn that read and then said
    // NOTHING, which `completes` (answered) still fails; a draft is not required.
    case "t-reads-and-says-nothing":
      return { ...CHANGE, proposes: undefined, maxToolCalls: 40, maxLatencyMs: 240_000 };
    default:
      return undefined;
  }
}
