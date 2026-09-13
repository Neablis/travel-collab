import type { ItineraryDayPayload } from "@tc/pages";

/**
 * A day's shape, as the parts of one line: date, cities, how many stops, when
 * it runs, what it costs.
 *
 * **This is the Timeline lens's day header, as data.** SPEC §24 deleted that
 * lens and said its read-only day list *"became a widget inside the Overview
 * document"* — but the widget it became rendered only stop TITLES, so the read
 * that came back was weaker than the one that went away. The timeline answered
 * "what is this day"; the widget answered "what is on it". These are the facts
 * that were missing, and they are shared by both day blocks so a day reads the
 * same whether it is one card or one row of the day-by-day table.
 *
 * Every part is omitted rather than rendered empty. A day with no date, no
 * city, no timed stop and no cost is a real state on a new trip, and "— · — ·
 * 0 stops · —" is noise pretending to be information. What is always present is
 * the stop count, which is a number rather than an absence: "0 stops" is an
 * answer, "no stops to show" would be a shrug (the distinction `count`'s own
 * doc comment makes).
 *
 * Joined by the caller, so a renderer can put the parts in separate elements —
 * the day-by-day row colours its cities, and a pre-joined string could not.
 */
export function dayMetaParts(day: ItineraryDayPayload): string[] {
  const stops = day.activities.length;
  return [
    ...(day.date === null ? [] : [day.date]),
    ...day.cities,
    `${stops} ${stops === 1 ? "stop" : "stops"}`,
    ...(day.window === null ? [] : [day.window]),
    ...(day.cost === null ? [] : [day.cost]),
  ];
}
