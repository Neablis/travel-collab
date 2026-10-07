import type { ActivityView, Location, PreviewDay, PreviewPlace, TripDetail, TripGlobals, TripGlobalsCity, TripPreview } from "@tc/contracts";
import type { WidgetContext } from "@tc/pages";

// **The only invite-specific widget code there is** (M38 D6). The invite page
// draws the trip with the notebook's own widgets — `MacroView` over the
// registry, read-only — and this builds the inputs they read (ADR-035: a widget
// is a function of declared inputs) from what `GET /api/invites/:token/preview`
// answers. There is no invite copy of any widget; `.dependency-cruiser.cjs`'s
// `invite-renders-shared-widgets-only` keeps it that way.
//
// It builds exactly what the fixed set (D5) reads: `dates` and
// `trip.countdown`, `trip.people`, `trip.strip`, `city.rows` and `cost`. Everything else on a
// `TripDetail` is the zero value of its type, and no widget outside the set is
// promised anything.
//
// **Ids are invented, deterministically.** The preview carries no user id
// (ADR-027), so the people are `p0`, `p1`, … in its join order — the order a
// per-trip colour clash is resolved in (D3) — and days and stops get fixed
// UUIDs by position, because the contract types them as UUIDs and nothing a
// stranger's page draws should depend on a real one.

/**
 * The widget context for a trip as an invite's holder may see it.
 *
 * `today` is the reader's own calendar day (`useToday`), for the countdown.
 */
export function previewContext(preview: TripPreview, today: string): WidgetContext {
  const ids = idsFrom(1);
  const activities: Record<string, ActivityView> = {};
  const days = preview.days.map((day) => ({
    dayId: ids(),
    date: day.date,
    costSubtotal: 0,
    activityIds: day.stops.map((stop) => {
      const activityId = ids();
      activities[activityId] = stopView(activityId, stop.title, locationOf(stop.location, day));
      return activityId;
    }),
  }));

  // **The total, and how it reaches `cost` without becoming anyone's share.**
  // `cost` sums stop costs (`costOfStops`, the board's own rollup), and no
  // preview stop carries one (D4). So the total rides on ONE unscheduled stop:
  // the backlog is counted only when no day, date or city is bound, so
  // `cost{}` reads the total and `cost{day}` / `cost{city}` read nothing.
  //
  // What keeps it off every person is that **no member travels here**. A stop
  // nobody picked is split between the travellers (`stopPeople`), so with none
  // it lands on nobody: `balances` skips it, and `person.share` and
  // `cost.balances` are empty. `stopHeadcount` floors at one, which is what
  // makes the sum `total × 1` exactly. Who is really travelling stays on the
  // preview's own `people[].travelling`; nothing in the fixed set reads it
  // from `trip.members`.
  const backlog: string[] = [];
  if (preview.total.amountMinor !== 0) {
    const activityId = ids();
    activities[activityId] = { ...stopView(activityId, "The trip's total", null), cost: preview.total };
    backlog.push(activityId);
  }

  const trip: TripDetail = {
    tripId: TRIP_ID,
    name: preview.name,
    status: "active",
    startDate: preview.startDate,
    currency: preview.total.currency,
    budget: null,
    // The first person is the owner (the contract's join order); the rest have
    // no role the preview says, and nothing in the fixed set reads one.
    members: preview.people.map((_, i) => ({ userId: personId(i), role: i === 0 ? "owner" : "viewer", travelling: false })),
    forkedFrom: null,
    days,
    backlog,
    activities,
    conflicts: [],
    dismissedConflictIds: [],
    createdAt: EPOCH,
    unscheduledCostSubtotal: preview.total.amountMinor,
    tripCostTotal: preview.total.amountMinor,
    budgetRemaining: null,
  };

  return {
    trip,
    page: { tripId: TRIP_ID },
    // A stranger: no account to read preferences from.
    user: null,
    globals: globalsOf(preview),
    today,
    people: Object.fromEntries(preview.people.map((person, i) => [personId(i), person.name])),
    // Who is really going, and how each looks, for `trip.people` — which reads
    // `travelling` here and never off the members above (`WidgetContext.personas`).
    personas: Object.fromEntries(
      preview.people.map(({ name, avatar, color, travelling }, i) => [personId(i), { name, avatar, color, travelling }]),
    ),
  };
}

const TRIP_ID = "00000000-0000-4000-8000-000000000000";
const EPOCH = "1970-01-01T00:00:00.000Z";

const personId = (index: number) => `p${index}`;

/** Fixed UUIDs, counted from `start`. */
function idsFrom(start: number): () => string {
  let next = start;
  return () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`;
}

function stopView(activityId: string, title: string, location: Location | null): ActivityView {
  return {
    activityId, title, location,
    timeWindow: null, notes: null, anchors: [], kind: "planned", tags: [], cost: null,
    bookedBy: null, participants: [], mode: null, endLocation: null, pendingReason: null,
  };
}

/**
 * A preview place as a stop's location.
 *
 * **A place with no city takes its day's city as its `area`**, so the strip
 * names the day exactly as the preview does. The server named it with
 * `cityFor` — the last stop's city, else its area — and the preview's place
 * carries no area, so a day named by one would otherwise read as no city.
 * `area` is the only fallback `dayCity` takes, and a city on any stop still
 * wins over it. The one day this cannot reproduce is one named by a train's
 * destination: the preview has no destination to carry.
 */
function locationOf(place: PreviewPlace | null, day: PreviewDay): Location | null {
  if (place === null) return null;
  return place.city === undefined && day.city !== null ? { ...place, area: day.city } : { ...place };
}

/**
 * The trip's cities and days, as `tripGlobals` derives them on the server —
 * which the browser may not import (`citiesOfDay` is `@tc/domain`). A day's
 * cities are its stops' own cities, de-duplicated, in order (the preview has
 * no times to order by); a city lists the days that touch it and counts the
 * stops located in it, by the stop's own city.
 */
function globalsOf(preview: TripPreview): TripGlobals {
  const cities = new Map<string, TripGlobalsCity>();
  const days = preview.days.map((day, index) => {
    const touched = [...new Set(day.stops.flatMap((stop) => (stop.location?.city ? [stop.location.city] : [])))];
    for (const name of touched) {
      const city = cities.get(name) ?? { name, dayIndexes: [], activityCount: 0 };
      city.dayIndexes.push(index);
      cities.set(name, city);
    }
    for (const stop of day.stops) {
      const city = stop.location?.city === undefined ? undefined : cities.get(stop.location.city);
      if (city) city.activityCount += 1;
    }
    return { index, date: day.date, cities: touched, activityCount: day.stops.length, costSubtotal: 0, place: null, timeZone: null };
  });
  return { days, cities: [...cities.values()], tags: [], homeTimeZone: null };
}
