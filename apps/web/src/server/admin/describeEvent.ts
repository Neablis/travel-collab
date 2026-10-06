// **A planning event as one line on the operator's account page** (M36 link 3).
//
// **It labels; it never interprets.** History stores and replays — what an
// event MEANS for a trip is the domain's reducers, and this is an admin read
// that must not grow a second opinion about that. So: the event's type picks a
// verb, the trip's current name fills the object, and at most a title the
// payload already carries as a plain string is quoted. No fold, no lookup of
// what the activity or day was, and an unknown type falls back to a sentence
// that is true of every event: something in that trip changed.

/** What each common event type is, as a sentence about `trip`. */
const SENTENCES: Record<string, (trip: string, title: string | null) => string> = {
  TripCreated: (trip) => `Created ${trip}`,
  TripNameSet: (trip) => `Renamed ${trip}`,
  TripStartDateSet: (trip) => `Changed the dates of ${trip}`,
  TripBudgetSet: (trip) => `Set the budget for ${trip}`,
  TripCurrencySet: (trip) => `Changed the currency of ${trip}`,
  TripDeleted: (trip) => `Deleted ${trip}`,
  TripRestored: (trip) => `Restored ${trip}`,
  DayAdded: (trip) => `Added a day to ${trip}`,
  DayRemoved: (trip) => `Removed a day from ${trip}`,
  ActivityAdded: (trip, title) => (title === null ? `Added a stop to ${trip}` : `Added “${title}” to ${trip}`),
  ActivityUpdated: (trip) => `Edited a stop in ${trip}`,
  ActivityMoved: (trip) => `Moved a stop in ${trip}`,
  ActivityRemoved: (trip) => `Removed a stop from ${trip}`,
  ConflictDismissed: (trip) => `Dismissed a conflict in ${trip}`,
  ConflictUndismissed: (trip) => `Brought back a conflict in ${trip}`,
  PageCreated: (trip, title) => (title === null ? `Started a page in ${trip}` : `Started the page “${title}” in ${trip}`),
  PageEdited: (trip) => `Edited a page in ${trip}`,
  PageDeleted: (trip) => `Deleted a page from ${trip}`,
};

/**
 * One event as a sentence. `tripName` is the trip's name now, from
 * `trip_summaries`, or `null` when the stream has no summary row.
 */
export function describeEvent(type: string, payload: unknown, tripName: string | null): string {
  const trip = tripName ?? "a trip";
  const title =
    typeof payload === "object" && payload !== null && typeof (payload as { title?: unknown }).title === "string"
      ? (payload as { title: string }).title
      : null;
  const sentence = SENTENCES[type];
  return sentence === undefined ? `Changed ${trip}` : sentence(trip, title);
}
