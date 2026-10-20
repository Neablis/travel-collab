import type { EventEnvelope, TripCommand, TripDetail, TripHistory, TripMemberProfile } from "@tc/contracts";
import {
  buildHistoryEntries,
  decideCreateTrip,
  decideTripCommand,
  describeByTags,
  evolveTrip,
  evolveTripEnvelope,
  foldEnvelopes,
  tripDetailFromState,
  type TripState,
} from "@tc/domain";
import {
  bundleTripCommandGroups,
  deterministicMintId,
  JAPAN_DEMO_ROSTER,
  JAPAN_TRIP_NAME,
  japanGroupAdders,
  japanTripCommandGroups,
  parseBundle,
  type JapanRosterEntry,
} from "@tc/fixtures";
// Static imports, not `fs`: a route reads these, and a bundler follows an
// import where it would not follow a path built at runtime. One per file in
// `content/trips/`; `demoTrip.test.ts` fails when a file has no line here.
import dolomitesWinter from "../../../../content/trips/dolomites-winter.json" with { type: "json" };
import icelandRingRoad from "../../../../content/trips/iceland-ring-road.json" with { type: "json" };
import northernSpain from "../../../../content/trips/northern-spain.json" with { type: "json" };
import thailandAndaman from "../../../../content/trips/thailand-andaman.json" with { type: "json" };
import { serverConflictContext } from "./conflictContext";
import { overlayMembers } from "./access/overlay";
import { withTripColors } from "./access/personaColors";
import { DEMO_TRIPS, demoTripById, type DemoTripCard } from "@/lib/demoTrip";
import { DEMO_TRIP_LEAD_DAYS, isoDateInDays } from "@/lib/seedDate";

// The trips behind `/demo/<slug>`: the ones a stranger looks around before
// they have an account (ADR-031, M42 D1).
//
// Japan is the SAME fixture `db:seed` writes and `pnpm seed:verify` checks;
// every other demo is a bundle FILE in `content/trips/`, through the same
// `bundleTripCommandGroups` the importer sends. Each is folded through the SAME
// domain functions the command pipeline uses, and then answered for at the
// SAME seam every trip read passes through (`requireTripAccess`). So a demo
// runs the real board: the real `TripProvider`, the real `/api/trips/:id`,
// `/history` and `/access` reads, the real lenses, the real History popover.
// Nothing about a demo is a second implementation of the product.
//
// The files, not the production copies of those trips: the importer creates a
// trip only if it is absent, so an imported copy keeps the tags it was first
// imported with, and the demo is meant to show the bundles as they are written.
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

/** The demos' "author". No such account exists; nothing authenticates as it. */
const DEMO_ACTOR_ID = "00000000-0000-4000-8000-00000000a000";

/**
 * Who a demo trip is planned by, and for, as the board shows them.
 *
 * `TripMember.userId` is a free-form string, and the board renders it directly
 * as the attribution label on a timeline card (`TimelineLens`: "TripMember
 * carries only a userId, no display name"). For a real trip that reads
 * "dev-alice"; for a demo it would have read
 * `00000000-0000-4000-8000-00000000a000` on every card. So the ids ARE the
 * names — which is honest, because no account is behind any of them.
 *
 * Several travellers rather than one because the fold produces exactly one
 * member — the actor that "issued" the commands — and a trip planned by one
 * person, on the one page arguing for planning together, undersells the
 * product it is demonstrating.
 *
 * No email addresses: an invented address on a public page is the kind of
 * thing that eventually gets mailed.
 *
 * Each carries the avatar and colour the roster says they chose (M38), and
 * `withTripColors` resolves them as it does for a real trip: on Japan two
 * chose plum, so that demo shows a clash shift.
 */
function membersOf(roster: readonly JapanRosterEntry[]): TripMemberProfile[] {
  return withTripColors(
    roster.map(({ name, role, travelling, avatar, color }) => ({
      userId: name,
      role,
      travelling,
      name,
      email: null,
      image: null,
      displayName: null,
      avatar,
      color,
    })),
  );
}

/**
 * The people a bundle's demo is planned by. A bundle carries no roster, since
 * its format has no people in it, so one is made up: three travellers, an
 * owner and two editors, drawn from this list at an offset per demo so the
 * demos are not all the same three friends. Every stop is everyone's, because
 * a bundle stop names no participants.
 */
const BUNDLE_CREW: readonly Pick<JapanRosterEntry, "name" | "avatar" | "color">[] = [
  { name: "Ana", avatar: "compass", color: "moss" },
  { name: "Ravi", avatar: "plane", color: "sky" },
  { name: "Lena", avatar: "tent", color: "clay" },
  { name: "Tomás", avatar: "palm", color: "ochre" },
  { name: "Ines", avatar: null, color: "rose" },
  { name: "Oskar", avatar: "mountain", color: "teal" },
];

function bundleRoster(ordinal: number): JapanRosterEntry[] {
  return [0, 1, 2].map((i) => ({
    ...BUNDLE_CREW[(ordinal - 1 + i) % BUNDLE_CREW.length]!,
    role: i === 0 ? "owner" : "editor",
    travelling: true,
  }));
}

/**
 * Every trip in the bundle files, by its own key (its demo's slug). Parsed at
 * module load, so a file the schema refuses fails every demo test rather than
 * one visitor's request.
 */
const BUNDLE_TRIPS = new Map(
  [dolomitesWinter, icelandRingRoad, northernSpain, thailandAndaman].flatMap((file) => {
    const bundle = parseBundle(file);
    return bundle.trips.map((trip) => [trip.key, { bundleKey: bundle.bundle.id, trip }] as const);
  }),
);

/**
 * Counter-derived uuids in a block of demo `ordinal`'s own: `8000` is Japan's
 * (`deterministicMintId`'s), `8001` the next demo's. Two demos minting the same
 * day id would be two trips sharing one, and the client keys its caches on ids.
 */
function demoMintId(ordinal: number): () => string {
  let n = 0;
  return () => `00000000-0000-4000-800${ordinal.toString(16)}-${String(++n).padStart(12, "0")}`;
}

/** What a demo is folded from: its name, its commands, and its people. */
type DemoSource = {
  name: string;
  roster: readonly JapanRosterEntry[];
  groups: (tripId: string, startDate: string) => TripCommand[][];
  /**
   * Who sends each group, index for index, so a stop's `addedBy` names one of
   * the people (M51 decision 8a). Absent, or `null` for a group, is dealt
   * round the roster instead.
   */
  adders?: readonly (string | null)[];
};

function sourceFor(ordinal: number, slug: string): DemoSource {
  if (ordinal === 0) {
    return {
      name: JAPAN_TRIP_NAME,
      roster: JAPAN_DEMO_ROSTER,
      // The member ids ARE the names (`membersOf`), so a stop's `participants`
      // are too, and the per-person totals (ADR-060) count the people the
      // fixture says are going rather than everyone on every stop.
      groups: (tripId, startDate) =>
        japanTripCommandGroups(tripId, { startDate, mintId: deterministicMintId(), travellerId: (name) => name }),
      adders: japanGroupAdders(),
    };
  }
  const found = BUNDLE_TRIPS.get(slug);
  if (found === undefined) throw new Error(`demo trip: no bundle in content/trips/ has a trip keyed ${slug}`);
  const { bundleKey, trip } = found;
  return {
    name: trip.name,
    roster: bundleRoster(ordinal),
    // Dated from the same lead as Japan rather than by the bundle's own
    // `startsInDays` (`tripStartDate` reads `startDate` first), so the snapshot
    // generator can fold every demo from one fixed date.
    groups: (tripId, startDate) =>
      bundleTripCommandGroups(bundleKey, { ...trip, startDate }, { tripId, today: startDate, mintId: demoMintId(ordinal) }),
  };
}

/**
 * How a demo's own history is spaced out, in hours per batch, ending now.
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

/** One fold per demo, by trip id. */
const memo = new Map<string, Demo>();

/**
 * Fold a demo's source into a trip, exactly as if someone had issued its commands.
 *
 * Every command goes through `decideTripCommand` — the real decider, not a
 * hand-built state — so a fixture the domain would reject fails here loudly
 * instead of rendering a half-built trip. `pnpm seed:verify` runs the same fold
 * over Japan, and `demoTrip.test.ts` folds every bundle, so that failure is
 * caught before this code ever runs.
 *
 * The events are wrapped in real `EventEnvelope`s as they are produced, one
 * `batchId` per command GROUP: the grouping `db:seed` and the importer use,
 * because one batch is one History entry, and the popover is one of the things
 * a visitor is being shown. Those envelopes then go through
 * `buildHistoryEntries` and `foldEnvelopes`, the same two functions that serve
 * a real trip's history and its point-in-time preview.
 */
function buildDemo(tripId: string, startDate: string): Demo {
  const demo = demoTripById(tripId);
  if (demo === undefined) throw new Error(`demo trip: ${tripId} is not a demo`);
  const ordinal = DEMO_TRIPS.indexOf(demo);
  const source = sourceFor(ordinal, demo.slug);
  const members = membersOf(source.roster);
  const ctx = { actorId: DEMO_ACTOR_ID };
  const now = Date.now();
  const envelopes: EventEnvelope[] = [];

  const groups = source.groups(tripId, startDate);
  // +1 for the genesis batch, which is a batch of the trip's history like any
  // other ("Trip created") and has to land before the ones that follow it.
  const batchCount = groups.length + 1;
  const occurredAtFor = (batchIndex: number) =>
    new Date(now - (batchCount - batchIndex) * HISTORY_BATCH_SPACING_MS).toISOString();

  // Deterministic batch ids, for the same reason the day and activity ids are
  // deterministic: the History popover keys its rows on them, so a re-fold on
  // a new instance must not present the same change as a different one.
  const batchId = (n: number) => `00000000-0000-4000-800${ordinal.toString(16)}-b${String(n).padStart(11, "0")}`;

  const append = (events: readonly { type: string; version: number; payload: unknown }[], batch: number, actorId = DEMO_ACTOR_ID) => {
    for (const event of events) {
      envelopes.push({
        streamId: tripId,
        seq: envelopes.length + 1,
        type: event.type,
        version: event.version,
        payload: event.payload,
        actorId,
        occurredAt: occurredAtFor(batch),
        batchId: batchId(batch),
        origin: { kind: "user" },
      });
    }
  };

  const genesis = decideCreateTrip(null, { type: "CreateTrip", tripId, name: source.name, forkedFrom: null }, ctx);
  if (!genesis.ok) throw new Error(`demo trip: CreateTrip rejected — ${genesis.rejection.message}`);
  append(genesis.events, 0);

  let state: TripState | null = null;
  for (const event of genesis.events) state = evolveTrip(state, event);

  groups.forEach((group, i) => {
    // Never the demo's own actor, who is on no roster: the board would name
    // a stranger as the stop's adder.
    const actorId = source.adders?.[i] ?? source.roster[i % source.roster.length]!.name;
    for (const command of group) {
      const decision = decideTripCommand(state, command, { actorId });
      if (!decision.ok) {
        throw new Error(`demo trip: ${command.type} rejected — ${decision.rejection.message}`);
      }
      append(decision.events, i + 1, actorId);
      // With the envelope's actor, so the detail's `addedBy` is the fold's.
      for (const event of decision.events) state = evolveTripEnvelope(state, event, { actorId });
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
    detail: overlayMembers(
      tripDetailFromState(state, envelopes[0]!.occurredAt, serverConflictContext()),
      members.map(({ userId, role, travelling }) => ({ userId, role, travelling })),
    ),
    history: {
      tripId,
      entries: buildHistoryEntries(envelopes).reverse(),
      // Not `deriveUndoRedo`'s answer, which would be `canUndo: true`. Undo is
      // a write, the demo refuses every write, and a history read that
      // advertised an action the server will refuse would be the board lying
      // to the one visitor least equipped to tell.
      canUndo: false,
      canRedo: false,
    },
    members,
  };
}

/**
 * A demo, built once per instance and re-used.
 *
 * Memoised on `startDate`, which is derived from today — so the fold happens
 * again the first time it is asked for on a new day, and every demo is always
 * upcoming without anything having to invalidate a cache. A fold is a few
 * hundred pure function calls; the memo is not there because it is expensive,
 * it is there so a burst of requests to one instance does it once.
 */
function demoTrip(tripId: string): Demo {
  const startDate = isoDateInDays(DEMO_TRIP_LEAD_DAYS);
  const cached = memo.get(tripId);
  if (cached !== undefined && cached.startDate === startDate) return cached;
  const fresh = buildDemo(tripId, startDate);
  memo.set(tripId, fresh);
  return fresh;
}

/**
 * A demo folded from a start date the caller chooses, bypassing the memo.
 *
 * For `scripts/landing-demo.ts`, which snapshots a slice of each demo for the
 * front door. A snapshot is drift-checked by regenerating it, so it has to be
 * folded from a fixed date rather than from today.
 */
export function demoTripDetailFor(tripId: string, startDate: string): TripDetail {
  return buildDemo(tripId, startDate).detail;
}

/** What `GET /api/trips/:id` serves for a demo, via `requireTripAccess`. */
export function demoTripDetail(tripId: string): TripDetail {
  return demoTrip(tripId).detail;
}

/** What `GET /api/trips/:id/history` serves for a demo. */
export function demoTripHistory(tripId: string): TripHistory {
  return demoTrip(tripId).history;
}

/** What the Travelers row in `GET /api/trips/:id/access` serves for a demo. */
export function demoTripMembers(tripId: string): TripMemberProfile[] {
  return demoTrip(tripId).members;
}

/** How many events a demo's fold appended: its head seq. */
export function demoTripHeadSeq(tripId: string): number {
  return demoTrip(tripId).envelopes.length;
}

/**
 * A demo replayed to a point in its own history, for the History popover's
 * preview. The same `foldEnvelopes` a real trip's preview uses, over envelopes
 * that were built rather than read.
 */
export function demoTripDetailAt(tripId: string, seq: number): TripDetail | null {
  const { envelopes } = demoTrip(tripId);
  if (!Number.isInteger(seq) || seq < 1 || seq > envelopes.length) return null;
  const state = foldEnvelopes(envelopes, seq);
  if (state === null) return null;
  return tripDetailFromState(state, envelopes[0]!.occurredAt, serverConflictContext());
}

/**
 * The picker's cards, one per demo, in `DEMO_TRIPS` order.
 *
 * The description is `describeByTags` over every activity, backlog included,
 * which is what the home card and the invite page describe a trip by
 * (ADR-070 §3), so the picker cannot call a trip something its copy, once
 * taken, would not be called.
 */
export function demoTripCards(): DemoTripCard[] {
  return DEMO_TRIPS.map(({ slug, tripId }) => {
    const detail = demoTripDetail(tripId);
    return {
      slug,
      name: detail.name,
      description: describeByTags(Object.values(detail.activities))?.text ?? null,
      dayCount: detail.days.length,
    };
  });
}
