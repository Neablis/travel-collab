import type { EventEnvelope, TripDetail, TripHistory, TripMemberProfile } from "@tc/contracts";
import {
  buildHistoryEntries,
  decideCreateTrip,
  decideTripCommand,
  evolveTrip,
  foldEnvelopes,
  tripDetailFromState,
  type TripState,
} from "@tc/domain";
import {
  deterministicMintId,
  JAPAN_TRIP_NAME,
  JAPAN_TRIP_TRAVELLERS,
  japanTripCommandGroups,
} from "@tc/fixtures";
import { serverConflictContext } from "./conflictContext";
import { DEMO_TRIP_ID, isDemoTripId } from "@/lib/demoTrip";
import { DEMO_TRIP_LEAD_DAYS, isoDateInDays } from "@/lib/seedDate";

// The trip behind `/demo` — the one a stranger looks around before they have an
// account (ADR-031).
//
// It is the SAME Japan fixture `db:seed` writes and `pnpm seed:verify` checks,
// folded through the SAME domain functions the command pipeline uses, and then
// answered for at the SAME seam every trip read passes through
// (`requireTripAccess`). So `/demo` runs the real board: the real
// `TripProvider`, the real `/api/trips/:id`, `/history` and `/access` reads, the
// real Day-columns, Timeline, Map and Calendar lenses, the real History
// popover. Nothing about the demo is a second implementation of the product.
//
// What it does not do is touch Postgres. There is no trip row, no event stream
// and no share row; nothing in this module's import graph reaches `db/client`,
// and a unit test mocks `pg` to throw on construction so it stays that way.
//
// This replaces `DEMO_SHARE_TOKEN` (KI-61). That env var made the front door's
// most prominent secondary CTA depend on a deploy step no test could enforce —
// unset, which was every preview branch, every fresh clone and CI, it rendered
// "Nothing to see here" — and it put a share lookup plus a full stream replay
// on the path of a page anyone can hit as often as they like.

export { DEMO_TRIP_ID, isDemoTripId };

/** The demo's "author". No such account exists; nothing authenticates as it. */
const DEMO_ACTOR_ID = "00000000-0000-4000-8000-00000000a000";

/**
 * Who the demo trip is planned by, and for.
 *
 * `TripMember.userId` is a free-form string, and the board renders it directly
 * as the attribution label on a timeline card (`TimelineLens`: "TripMember
 * carries only a userId, no display name"). For a real trip that reads
 * "dev-alice"; for the demo it would have read
 * `00000000-0000-4000-8000-00000000a000` on all 68 cards. So the ids ARE the
 * names — which is honest, because no account is behind any of them.
 *
 * Four rather than one because the fold produces exactly one member — the
 * actor that "issued" the commands — and a trip planned by one person, on the
 * one page arguing for planning together, undersells the product it is
 * demonstrating. It is part of the fixture's fiction like its name and its 72
 * stops, and `JAPAN_TRIP_TRAVELLERS` is where that count is declared.
 *
 * No email addresses: an invented address on a public page is the kind of
 * thing that eventually gets mailed.
 */
const DEMO_TRAVELLERS: TripMemberProfile[] = ["Mika", "Jonah", "Priya", "Sam"]
  .slice(0, JAPAN_TRIP_TRAVELLERS)
  .map((name, i) => ({
    userId: name,
    role: i === 0 ? "owner" : "editor",
    name,
    email: null,
    image: null,
  }));

/**
 * How the demo's own history is spaced out, in hours per batch, ending now.
 *
 * The History popover is part of what `/demo` is showing off, and a trip whose
 * every change happened in the same millisecond reads as machine output. One
 * batch per hour over the last ~16 hours reads as an evening of planning, which
 * is what the fixture is meant to look like.
 */
const HISTORY_BATCH_SPACING_MS = 60 * 60 * 1000;

type Demo = {
  detail: TripDetail;
  history: TripHistory;
  envelopes: EventEnvelope[];
  members: TripMemberProfile[];
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
 *
 * The events are wrapped in real `EventEnvelope`s as they are produced, one
 * `batchId` per command GROUP — `japanTripCommandGroups`, the same grouping
 * `db:seed` uses, because its own doc comment says to use it "when the History
 * popover matters". Here it matters: the popover is one of the things a visitor
 * is being shown. Those envelopes then go through `buildHistoryEntries` and
 * `foldEnvelopes`, the same two functions that serve a real trip's history and
 * its point-in-time preview.
 */
function buildDemo(startDate: string): Demo {
  const ctx = { actorId: DEMO_ACTOR_ID };
  const now = Date.now();
  const envelopes: EventEnvelope[] = [];

  const groups = japanTripCommandGroups(DEMO_TRIP_ID, { startDate, mintId: deterministicMintId() });
  // +1 for the genesis batch, which is a batch of the trip's history like any
  // other ("Trip created") and has to land before the ones that follow it.
  const batchCount = groups.length + 1;
  const occurredAtFor = (batchIndex: number) =>
    new Date(now - (batchCount - batchIndex) * HISTORY_BATCH_SPACING_MS).toISOString();

  // Deterministic batch ids, for the same reason the day and activity ids are
  // deterministic: the History popover keys its rows on them, so a re-fold on
  // a new instance must not present the same change as a different one.
  const batchId = (n: number) => `00000000-0000-4000-8000-b${String(n).padStart(11, "0")}`;

  const append = (events: readonly { type: string; version: number; payload: unknown }[], batch: number) => {
    for (const event of events) {
      envelopes.push({
        streamId: DEMO_TRIP_ID,
        seq: envelopes.length + 1,
        type: event.type,
        version: event.version,
        payload: event.payload,
        actorId: DEMO_ACTOR_ID,
        occurredAt: occurredAtFor(batch),
        batchId: batchId(batch),
        origin: { kind: "user" },
      });
    }
  };

  const genesis = decideCreateTrip(
    null,
    { type: "CreateTrip", tripId: DEMO_TRIP_ID, name: JAPAN_TRIP_NAME, forkedFrom: null },
    ctx,
  );
  if (!genesis.ok) throw new Error(`demo trip: CreateTrip rejected — ${genesis.rejection.message}`);
  append(genesis.events, 0);

  let state: TripState | null = null;
  for (const event of genesis.events) state = evolveTrip(state, event);

  groups.forEach((group, i) => {
    for (const command of group) {
      const decision = decideTripCommand(state, command, ctx);
      if (!decision.ok) {
        throw new Error(`demo trip: ${command.type} rejected — ${decision.rejection.message}`);
      }
      append(decision.events, i + 1);
      for (const event of decision.events) state = evolveTrip(state, event);
    }
  });
  if (state === null) throw new Error("demo trip: the fixture produced no events");

  return {
    startDate,
    envelopes,
    // The travellers are overlaid onto the detail, exactly as
    // `requireTripAccess` overlays the effective member list onto a real
    // trip's projection: membership is a fact about the answer, not about the
    // plan. It matters that this lands on the DETAIL and not only on the
    // access read — the board renders `detail.members` in three places (the
    // meta pill's traveller count, the timeline's attribution chip, the map
    // card's), and a demo whose folded state carries one synthetic member
    // showed "1 travellers" beside a raw uuid on every timeline card.
    detail: { ...tripDetailFromState(state, envelopes[0]!.occurredAt, serverConflictContext()), members: DEMO_TRAVELLERS.map(({ userId, role }) => ({ userId, role })) },
    history: {
      tripId: DEMO_TRIP_ID,
      entries: buildHistoryEntries(envelopes).reverse(),
      // Not `deriveUndoRedo`'s answer, which would be `canUndo: true`. Undo is
      // a write, the demo refuses every write, and a history read that
      // advertised an action the server will refuse would be the board lying
      // to the one visitor least equipped to tell.
      canUndo: false,
      canRedo: false,
    },
    members: DEMO_TRAVELLERS,
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
function demoTrip(): Demo {
  const startDate = isoDateInDays(DEMO_TRIP_LEAD_DAYS);
  if (memo === null || memo.startDate !== startDate) memo = buildDemo(startDate);
  return memo;
}

/** What `GET /api/trips/:id` serves for the demo, via `requireTripAccess`. */
export function demoTripDetail(): TripDetail {
  return demoTrip().detail;
}

/** What `GET /api/trips/:id/history` serves for the demo. */
export function demoTripHistory(): TripHistory {
  return demoTrip().history;
}

/** What the Travelers row in `GET /api/trips/:id/access` serves for the demo. */
export function demoTripMembers(): TripMemberProfile[] {
  return demoTrip().members;
}

/** How many events the fold appended — the demo's head seq. */
export function demoTripHeadSeq(): number {
  return demoTrip().envelopes.length;
}

/**
 * The demo replayed to a point in its own history, for the History popover's
 * preview. The same `foldEnvelopes` a real trip's preview uses, over envelopes
 * that were built rather than read.
 */
export function demoTripDetailAt(seq: number): TripDetail | null {
  const { envelopes } = demoTrip();
  if (!Number.isInteger(seq) || seq < 1 || seq > envelopes.length) return null;
  const state = foldEnvelopes(envelopes, seq);
  if (state === null) return null;
  return tripDetailFromState(state, envelopes[0]!.occurredAt, serverConflictContext());
}
