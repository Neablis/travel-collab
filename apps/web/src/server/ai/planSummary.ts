// Plain-language phrasing of planning commands, in the two moods the assistant
// needs them in: the receipt for a batch that HAS applied ("Done — moved
// “Treasure Island” to day 2 and added “Dinner in Oakland” to the backlog.")
// and the proposal card's line for one that has not ("Move “Treasure Island”
// to day 2"). Kept in its own module (types-only imports, no server/DB/auth
// dependencies) so it's unit-testable — the DB-backed route.int test can't run
// without a migrated test DB, and importing handleAskRequest pulls in next-auth,
// which won't load under the jsdom unit runner.
//
// Derived from the commands (not the model's own narration), so it can never
// claim an edit the batch didn't make. Names are resolved against whatever
// trip detail the caller passes, and the two callers pass different ones (see
// `describeCommand`).
import type { BatchableCommand, TripDetail } from "@tc/contracts";

/**
 * `"applied"`: the past tense of a receipt, read after the batch committed.
 * `"proposed"`: the imperative of the proposal card, read above an Approve
 * button. The mood is the whole point: "Done — added a day" shown above that
 * button claims the thing it has not done yet.
 */
export type CommandMood = "applied" | "proposed";

/**
 * One command, said in one mood — the single place a `BatchableCommand` is put
 * into words (KI-80 collapsed the second, conditional-mood switch that lived in
 * writeTools.ts into this one).
 *
 * Two differences between the moods are kept on purpose, not by accident of
 * history. An unknown day is "a day" in the receipt but "a new day" on the
 * card, because a proposal can name a day the same batch adds, which no detail
 * holds yet. And the rename is quoted straight in the receipt and curly on the
 * card; both are pinned by their callers' tests (`planSummary.test.ts`).
 *
 * **The snapshot is the caller's.** `buildProposal` labels days against the
 * propose-time detail and `commitProposal` against the apply-time one, so if
 * another editor reorders the days in between, the card can say "day 1" and
 * the receipt "day 2" for the same command. Nothing is mis-applied (the command
 * carries a `dayId`, not a position); only the two labels disagree.
 *
 * The switch is exhaustive over `BatchableCommand["type"]` with no `default`,
 * so a thirteenth command fails to compile until someone words it, once.
 */
export function describeCommand(command: BatchableCommand, detail: TripDetail, mood: CommandMood): string {
  const applied = mood === "applied";
  // The verb is the only word the moods disagree on in most cases.
  const say = (past: string, imperative: string): string => (applied ? past : imperative);
  const activityTitle = (activityId: string): string => detail.activities[activityId]?.title ?? "an activity";
  const dayLabel = (dayId: string): string => {
    const index = detail.days.findIndex((d) => d.dayId === dayId);
    if (index !== -1) return `day ${index + 1}`;
    return applied ? "a day" : "a new day";
  };

  switch (command.type) {
    case "AddDay":
      return `${say("added", "Add")} a day`;
    case "RemoveDay":
      return `${say("removed", "Remove")} ${dayLabel(command.dayId)}`;
    case "SetTripStartDate":
      return command.startDate === null
        ? `${say("cleared", "Clear")} the start date`
        : `${say("set", "Set")} the start date to ${command.startDate}`;
    case "AddActivity":
      return `${say("added", "Add")} “${command.title}” to ${command.dayId ? dayLabel(command.dayId) : "the backlog"}`;
    case "UpdateActivity":
      return `${say("updated", "Update")} “${activityTitle(command.activityId)}”`;
    case "MoveActivity":
      return `${say("moved", "Move")} “${activityTitle(command.activityId)}” to ${command.toDayId === null ? "the backlog" : dayLabel(command.toDayId)}`;
    case "RemoveActivity":
      return `${say("removed", "Remove")} “${activityTitle(command.activityId)}”`;
    case "DismissConflict":
      return `${say("dismissed", "Dismiss")} a conflict`;
    case "SetTripCurrency":
      return `${say("set", "Set")} the currency to ${command.currency}`;
    case "SetTripBudget":
      return command.budget === null ? `${say("cleared", "Clear")} the budget` : `${say("set", "Set")} the budget`;
    case "SetTripName":
      return applied ? `renamed the trip to "${command.name}"` : `Rename the trip to “${command.name}”`;
    case "SetTripDates":
      return command.startDate !== null && command.endDate !== null
        ? `${say("set", "Set")} the trip dates to ${command.startDate} – ${command.endDate}`
        : `${say("set", "Set")} the trip dates`;
  }
}

/**
 * The receipt for a batch that has applied, from the committed commands.
 * Names resolve against the PRE-change trip detail: every referenced existing
 * activity/day still exists there (removed ones included), and new activities
 * carry their title in the command itself.
 */
export function summarizeBatch(calls: BatchableCommand[], detail: TripDetail): string {
  return `Done — ${joinPhrases(calls.map((c) => describeCommand(c, detail, "applied")))}.`;
}

// "a", "a and b", "a, b, and c" — Oxford comma for 3+.
function joinPhrases(phrases: string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? "no changes";
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}
