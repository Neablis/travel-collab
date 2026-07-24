// Plain-language summary of an applied planning batch, e.g.
// "Done — moved “Treasure Island” to day 2 and added “Dinner in Oakland” to
// the backlog." Kept in its own module (types-only imports, no server/DB/auth
// dependencies) so it's unit-testable — the DB-backed route.int test can't run
// without a migrated test DB, and importing handleAiRequest pulls in next-auth,
// which won't load under the jsdom unit runner.
//
// Derived from the committed commands (not the model's own narration), so it
// can never claim an edit the batch didn't make. Names are resolved against the
// PRE-change trip detail: every referenced existing activity/day still exists
// there (removed ones included), and new activities carry their title in the
// command itself.
import type { BatchableCommand, TripDetail } from "@tc/contracts";

export function summarizeBatch(calls: BatchableCommand[], detail: TripDetail): string {
  const activityTitle = (activityId: string): string =>
    detail.activities[activityId]?.title ?? "an activity";
  const dayLabel = (dayId: string): string => {
    const index = detail.days.findIndex((d) => d.dayId === dayId);
    return index === -1 ? "a day" : `day ${index + 1}`;
  };

  const phrases = calls.map((c): string => {
    switch (c.type) {
      case "AddDay":
        return "added a day";
      case "RemoveDay":
        return `removed ${dayLabel(c.dayId)}`;
      case "SetTripStartDate":
        return c.startDate === null ? "cleared the start date" : `set the start date to ${c.startDate}`;
      case "AddActivity":
        return `added “${c.title}” to ${c.dayId ? dayLabel(c.dayId) : "the backlog"}`;
      case "UpdateActivity":
        return `updated “${activityTitle(c.activityId)}”`;
      case "MoveActivity":
        return `moved “${activityTitle(c.activityId)}” to ${c.toDayId === null ? "the backlog" : dayLabel(c.toDayId)}`;
      case "RemoveActivity":
        return `removed “${activityTitle(c.activityId)}”`;
      case "DismissConflict":
        return "dismissed a conflict";
      case "SetTripCurrency":
        return `set the currency to ${c.currency}`;
      case "SetTripBudget":
        return c.budget === null ? "cleared the budget" : "set the budget";
    }
  });

  return `Done — ${joinPhrases(phrases)}.`;
}

// "a", "a and b", "a, b, and c" — Oxford comma for 3+.
function joinPhrases(phrases: string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? "no changes";
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}
