/**
 * The built-in demo trips' identities, on the UI side of the lint wall (ADR-031).
 *
 * Fixed, obviously-synthetic ids. Every real trip's id comes from
 * `randomUUID`, so these cannot collide with one, and they are stable across
 * instances and deploys — which matters twice: each is what `/demo/<slug>`
 * asks the ordinary trip endpoints for, and it ends up in the `forkedFrom`
 * lineage of every trip copied from that demo.
 *
 * They name no row in any table, by construction. `server/demoTrip.ts` folds
 * the Japan fixture and each bundle under `content/trips/` in memory and
 * answers for them at the one access seam every trip read passes through, so
 * the demos travel the real routes without ever being stored. Nothing may
 * follow these ids as links to a trip page: `/trips/<id>` is a 404 behind a
 * sign-in wall. `/demo/<slug>` is where each renders.
 *
 * In `lib/` rather than `server/` because both sides need it — the board's
 * chrome asks "am I a demo?" to drop the controls a signed-out visitor has
 * no session for, and the server asks it to decide what to serve.
 */

export type DemoTrip = {
  /** The path segment under `/demo`: a bundle trip's own `key`, so the file names it. */
  slug: string;
  tripId: string;
};

/**
 * Every demo, in the order the picker lists them: Japan, then each trip in
 * `content/trips/` (M42 D1). `server/demoTrip.test.ts` holds this list to that
 * directory, so a new bundle cannot be left out.
 *
 * Japan keeps the `…d000` it has always had, because copies of it already
 * carry that id as their lineage. The bundles count up from it.
 */
export const DEMO_TRIPS: readonly DemoTrip[] = [
  { slug: "japan", tripId: "00000000-0000-4000-8000-00000000d000" },
  { slug: "dolomites-winter", tripId: "00000000-0000-4000-8000-00000000d001" },
  { slug: "iceland-ring-road", tripId: "00000000-0000-4000-8000-00000000d002" },
  { slug: "northern-spain", tripId: "00000000-0000-4000-8000-00000000d003" },
  { slug: "thailand-andaman", tripId: "00000000-0000-4000-8000-00000000d004" },
];

/** The Japan demo: the one the landing's hero draws and the assistant's tests read. */
export const DEMO_TRIP_ID = DEMO_TRIPS[0]!.tripId;

/** One card on the `/demo` picker, worked out by `demoTripCards` on the server. */
export type DemoTripCard = {
  slug: string;
  name: string;
  /** What kind of trip it is (M42 D8), or null when too few of its stops are tagged to say. */
  description: string | null;
  dayCount: number;
};

/** The picker. Not under `/trips`, which middleware guards, and neither is any demo. */
export const DEMO_PATH = "/demo";

const BY_TRIP_ID = new Map(DEMO_TRIPS.map((demo) => [demo.tripId, demo]));
const BY_SLUG = new Map(DEMO_TRIPS.map((demo) => [demo.slug, demo]));

export function isDemoTripId(tripId: string): boolean {
  return BY_TRIP_ID.has(tripId);
}

/** The demo with this id, or undefined for every other trip. */
export function demoTripById(tripId: string): DemoTrip | undefined {
  return BY_TRIP_ID.get(tripId);
}

/** The demo at `/demo/<slug>`, or undefined: an unknown slug is a 404. */
export function demoTripBySlug(slug: string): DemoTrip | undefined {
  return BY_SLUG.get(slug);
}

/** Where one demo's board renders. */
export function demoPath(slug: string): string {
  return `${DEMO_PATH}/${slug}`;
}

/** Whether a pathname is one demo's board (`/demo/<slug>`), as opposed to the picker. */
export function isDemoBoardPath(pathname: string): boolean {
  const prefix = `${DEMO_PATH}/`;
  return pathname.startsWith(prefix) && BY_SLUG.has(pathname.slice(prefix.length));
}
