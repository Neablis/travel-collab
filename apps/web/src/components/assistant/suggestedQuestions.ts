import type { TripDetail } from "@tc/contracts";
import { needsBooking } from "@/lib/booking";

/**
 * Four, because the rail is 356px wide: a fifth chip turns a suggestion list
 * into a menu, and a menu is something you read instead of something that
 * gets you talking.
 */
export const MAX_SUGGESTIONS = 4;

/**
 * The rail's opening questions, DERIVED from the trip in front of the user.
 *
 * It replaces `PREVIEW_QUICK_ASKS`, a hardcoded array that asked about hotels
 * on trips with no hotels. The rule every branch below is shaped by:
 *
 *   **Never suggest a question whose honest answer is "there isn't one."**
 *
 * A suggestion the assistant has to refuse is worse than no suggestion — the
 * user reads the refusal as the assistant being broken rather than the chip
 * being wrong. So each question is gated on the data it would need, and a
 * trip with nothing in it gets one question about starting rather than four
 * about content that does not exist. That extends to data the assistant
 * cannot *see*, not just data the trip does not *have*: `/ask`'s read tools
 * report days and their stops, so nothing here asks about the unscheduled
 * backlog.
 *
 * Pure — `(TripDetail, focusedDay) => string[]`, no hooks, no clock, no
 * fetch — so the rules are testable without a render.
 *
 * `focusedDay` is the 0-BASED index `FocusProvider` holds and `/ask`'s scope
 * carries. Every number the *user* reads is 1-based, matching the day chips.
 * The conversion happens here and nowhere else, for the same reason
 * `readTools.ts` converts once on the server.
 */
export function suggestedQuestions(trip: TripDetail, focusedDay: number | null): string[] {
  // "Active" is conflicts minus dismissals, the same filter ConflictBanner and
  // the /ask context envelope both apply.
  const dismissed = new Set(trip.dismissedConflictIds);
  const activeConflicts = trip.conflicts.filter((c) => !dismissed.has(c.id));

  // M18's contract fields are merged and readable; this reads `kind` and
  // builds none of M18's surfaces. The rule itself is `@/lib/booking`'s
  // `needsBooking`, shared with `readTools.ts` so the half that OFFERS this
  // question and the half that ANSWERS it cannot disagree about what the number
  // means (final branch review, 2026-08-29, finding 1).
  const stopNeedsBooking = (activityId: string): boolean => {
    const activity = trip.activities[activityId];
    return activity !== undefined && needsBooking(activity.kind);
  };

  if (trip.days.length === 0) {
    // No day to ask about, no stop to book, no gap to find. The only honest
    // question is the one that starts the plan.
    return ["There are no days yet — how should I start planning this trip?"];
  }

  // An index left over from a day that has since been removed reads as no
  // focus at all — the wider and safer reading, the same call `parseAskScope`
  // makes server-side for a scope line it cannot parse.
  const day = focusedDay === null ? undefined : trip.days[focusedDay];
  if (day !== undefined && focusedDay !== null) {
    const n = focusedDay + 1;
    const questions: string[] = [];

    if (day.activityIds.length === 0) {
      questions.push(`Day ${n} is empty — what could I do with it?`);
    } else {
      questions.push(`What's the plan for day ${n}?`);
      questions.push(`Where's the most free time on day ${n}?`);
    }

    // Conflicts are trip-wide, but a day-scoped turn is instructed not to
    // wander off its day. Offering "what about the 2 open conflicts?" while
    // looking at a day that has none is the "there isn't one" answer.
    const onThisDay = new Set(day.activityIds);
    const dayConflicts = activeConflicts.filter((c) => c.subjects.some((s) => onThisDay.has(s)));
    if (dayConflicts.length === 1) {
      questions.push(`There's 1 conflict on day ${n} — how should I fix it?`);
    } else if (dayConflicts.length > 1) {
      questions.push(`There are ${dayConflicts.length} conflicts on day ${n} — how should I fix them?`);
    }

    if (day.activityIds.some(stopNeedsBooking)) {
      questions.push(`What on day ${n} still needs booking?`);
    }

    return questions.slice(0, MAX_SUGGESTIONS);
  }

  const questions: string[] = ["How is the trip looking?"];

  // With nothing scheduled anywhere, every day has the same amount of free
  // time and the answer is "all of them".
  const scheduled = trip.days.flatMap((d) => d.activityIds);
  if (scheduled.length > 0) questions.push("Which day has the most free time?");

  if (activeConflicts.length === 1) {
    questions.push("There's 1 conflict still open — what should I do about it?");
  } else if (activeConflicts.length > 1) {
    questions.push(`There are ${activeConflicts.length} conflicts still open — what should I do about them?`);
  }

  const toBook = scheduled.filter(stopNeedsBooking).length;
  if (toBook === 1) {
    questions.push("1 stop still needs booking — which is it?");
  } else if (toBook > 1) {
    questions.push(`${toBook} stops still need booking — which should I sort out first?`);
  }

  return questions.slice(0, MAX_SUGGESTIONS);
}
