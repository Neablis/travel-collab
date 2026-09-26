// `day.detail {view: "schedule"}` — the days as a printed itinerary (M30).
//
// A separate payload from `ItineraryTripPayload`, not a flag on it: that one is
// the at-a-glance table (a row per day, three stops named and "+N more"), and
// the renderer it feeds is built around exactly that. This one is every stop,
// in time order, with where it is and whether it still needs booking — the
// shape a travel agent's itinerary has, and a different component.
//
// Every string is display-ready, as in every block payload: the renderer has no
// formatter of its own.

/** One line of a day's schedule. */
export interface ItineraryStop {
  /** Start time in the reader's clock ("9:00 am"), or `null` for an untimed stop. */
  time: string | null;
  /** End time, only when the stop has a window; the renderer prints it small. */
  until: string | null;
  title: string;
  /** Where: the place's name and, when it differs, its city. `null` when unplaced. */
  place: string | null;
  /**
   * The stop's standing, in words, or `null` when it needs none said.
   *
   * `pending` is "To book" — `needsBooking`'s rule, the same as Calendar's
   * count — and `transit` is "Travel". `planned` says nothing: since M28 it is
   * the default a stop is in, so labelling it would print a word on every line
   * that carries no news (ADR-054).
   */
  status: "To book" | "Travel" | null;
}

export interface ItineraryScheduleDay {
  dayId: string;
  /** Which day of the trip, counting from 1. */
  ordinal: number;
  /** "Monday 12 October", or `null` for an undated day. */
  date: string | null;
  cities: string[];
  stops: ItineraryStop[];
}

export interface ItineraryPayload {
  kind: "itinerary-schedule";
  days: ItineraryScheduleDay[];
}
