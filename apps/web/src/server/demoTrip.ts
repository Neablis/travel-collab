import type { SharedTripView, TripDetail } from "@tc/contracts";
import {
  decideCreateTrip,
  decideTripCommand,
  evolveTrip,
  tripDetailFromState,
  type TripState,
} from "@tc/domain";
import { deterministicMintId, JAPAN_TRIP_NAME, JAPAN_TRIP_TRAVELLERS, japanTripCommands } from "@tc/fixtures";
import { toSharedView } from "./access/sharedView";
import { DEMO_TRIP_LEAD_DAYS, isoDateInDays } from "@/lib/seedDate";

// The trip behind `/s/featured` — the one a stranger looks around before they
// have an account (ADR-031).
//
// It is the SAME Japan fixture `db:seed` writes and `pnpm seed:verify` checks,
// folded through the SAME domain functions the command pipeline uses
// (`decideTripCommand` → `evolveTrip` → `tripDetailFromState`), and served
// through the same `/api/shares/:token` shape and the same `SharedTripView`
// contract as any real share. What it does not do is touch Postgres: there is
// no share row, no event stream and no replay, and nothing in this module's
// import graph reaches `db/client` — which is why `toSharedView` was lifted
// into its own pure module (`access/sharedView.ts`).
//
// This replaces `DEMO_SHARE_TOKEN` (KI-61). That env var made the front door's
// most prominent secondary CTA depend on a deploy step no test could enforce —
// unset, which was every preview branch, every fresh clone and CI, it rendered
// "Nothing to see here" — and it put a share lookup plus a full stream replay
// on the path of a page anyone can hit as often as they like.

/**
 * A fixed, obviously-synthetic id. Every real trip's id is a v4 UUID from
 * `randomUUID`, so this cannot collide with one, and it is stable across
 * instances and deploys — which matters because it ends up in the
 * `forkedFrom` lineage of every trip cloned from the demo.
 *
 * It names no row in any table, by construction. Nothing may follow it as a
 * link: `SettingsSheet` renders `forkedFrom.name`/`atSeq` as text, which is
 * the only thing lineage is used for today. A future feature that turns that
 * into a link to the source trip has to special-case this id.
 */
export const DEMO_TRIP_ID = "00000000-0000-4000-8000-00000000d000";

/** The demo's "author". No such account exists; nothing authenticates as it. */
const DEMO_ACTOR_ID = "00000000-0000-4000-8000-00000000a000";

type Demo = {
  detail: TripDetail;
  view: SharedTripView;
  /** How many events the fold appended — the demo's equivalent of a share pin. */
  seq: number;
  /** The `startDate` this fold was built for; the memo key. */
  startDate: string;
};

let memo: Demo | null = null;

/**
 * Fold the fixture into a trip, exactly as if someone had issued its commands.
 *
 * Every command goes through `decideTripCommand` — the real decider, not a
 * hand-built state — so a fixture the domain would reject fails here loudly
 * instead of rendering a half-built trip. `pnpm seed:verify` runs the same fold
 * inside `pnpm check`, so that failure is caught before this code ever runs.
 */
function buildDemo(startDate: string): Demo {
  const ctx = { actorId: DEMO_ACTOR_ID };
  const createdAt = new Date().toISOString();

  const genesis = decideCreateTrip(
    null,
    { type: "CreateTrip", tripId: DEMO_TRIP_ID, name: JAPAN_TRIP_NAME, forkedFrom: null },
    ctx,
  );
  if (!genesis.ok) throw new Error(`demo trip: CreateTrip rejected — ${genesis.rejection.message}`);

  let state: TripState | null = null;
  let seq = 0;
  for (const event of genesis.events) {
    state = evolveTrip(state, event);
    seq += 1;
  }

  // Deterministic ids, so the demo renders the same day and activity ids on
  // every instance and every request. A real trip's ids come from
  // `randomUUID`; these are counter-derived from an all-zeros prefix, so they
  // are valid UUIDs (the contract requires it) that no real trip can hold.
  const mintId = deterministicMintId();
  for (const command of japanTripCommands(DEMO_TRIP_ID, { startDate, mintId })) {
    const decision = decideTripCommand(state, command, ctx);
    if (!decision.ok) {
      throw new Error(`demo trip: ${command.type} rejected — ${decision.rejection.message}`);
    }
    for (const event of decision.events) {
      state = evolveTrip(state, event);
      seq += 1;
    }
  }
  if (state === null) throw new Error("demo trip: the fixture produced no events");

  const detail = tripDetailFromState(state, createdAt);
  return {
    detail,
    seq,
    startDate,
    // `stale: false` by construction — `currentSeq === seq`. A real share can
    // go stale because the trip behind it keeps moving; the demo has nothing
    // behind it to move, and saying "it has changed since" about a fixture
    // would be a lie the page has no way to make true.
    //
    // `travellerCount` comes from the fixture, not from the folded state:
    // members are Access & Membership's data (module map) and a folded trip
    // has exactly one — see JAPAN_TRIP_TRAVELLERS for why the demo declares it.
    view: toSharedView(detail, { seq, createdAt }, JAPAN_TRIP_TRAVELLERS, seq),
  };
}

/**
 * The demo, built once per instance and re-used.
 *
 * Memoised on `startDate`, which is derived from today — so the fold happens
 * again the first time it is asked for on a new day, and the demo trip is
 * always upcoming without anything having to invalidate a cache. The fold is
 * ~450 pure function calls over ~70 commands; the memo is not there because it
 * is expensive, it is there so a burst of requests to one instance does it once.
 */
export function demoTrip(): Demo {
  const startDate = isoDateInDays(DEMO_TRIP_LEAD_DAYS);
  if (memo === null || memo.startDate !== startDate) memo = buildDemo(startDate);
  return memo;
}

/** What `GET /api/shares/featured` serves — the same narrowed public view any share is served as. */
export function demoSharedTripView(): SharedTripView {
  return demoTrip().view;
}

/** The full planning state, for the clone path. Never served to a browser. */
export function demoTripDetail(): TripDetail {
  return demoTrip().detail;
}
