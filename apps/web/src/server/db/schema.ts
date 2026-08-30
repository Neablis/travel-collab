import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Origin, SavedStop, TripDetail, TripMember, PageContent, PageContext } from "@tc/contracts";

// M11 link 1 (ADR-025). Identity is an ordinary CRUD module (AGENTS.md module
// map), not event-sourced — ADR-003 scopes the log to planning. The only
// writer is the Auth.js sign-in callback via `server/users.ts`.
//
// `id` is the Auth.js user id verbatim: Google's `sub`, or `dev-<username>`
// from the dev-login provider. That is already the exact string stored in
// `events.actor_id`, `pages.actor_id` and `TripMember.userId`, so adding this
// table changed no column type anywhere — which is the point of keeping JWT
// sessions rather than moving Auth.js onto a database adapter (ADR-025).
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const events = pgTable(
  "events",
  {
    globalSeq: bigserial("global_seq", { mode: "number" }).primaryKey(),
    streamId: uuid("stream_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    version: integer("version").notNull(),
    payload: jsonb("payload").notNull(),
    // Refers to `users.id` (ADR-025), deliberately with no database foreign
    // key. The log carries actors that are not people — `pages.actor_id` is
    // 'system' for lazily seeded default pages — plus every row written in the
    // eight milestones before the table existed; and a FK here would put an
    // Identity write on the planning-command path, the ADR-003 boundary smell.
    // The reference is upheld at the single seam that mints an actor id
    // instead: sign-in writes the user row before a session exists, so every
    // actor id derived from a session already has one (users.int.test.ts).
    actorId: text("actor_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    batchId: uuid("batch_id").notNull(),
    origin: jsonb("origin").$type<Origin>().notNull(),
  },
  (t) => [uniqueIndex("events_stream_seq").on(t.streamId, t.seq)],
);

export const tripSummaries = pgTable("trip_summaries", {
  tripId: uuid("trip_id").primaryKey(),
  name: text("name").notNull(),
  members: jsonb("members").$type<TripMember[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  status: text("status").notNull().default("active"),
});

export const tripDetails = pgTable("trip_details", {
  tripId: uuid("trip_id").primaryKey(),
  doc: jsonb("doc").$type<TripDetail>().notNull(),
});

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey(),
    tripId: uuid("trip_id").notNull(),
    title: text("title").notNull(),
    context: jsonb("context").$type<PageContext>().notNull(),
    content: jsonb("content").$type<PageContent>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    // 'system' for the lazily seeded default pages below; otherwise a
    // `users.id`, on the same terms as `events.actor_id` above.
    actorId: text("actor_id").notNull(),
  },
  (t) => [
    index("pages_trip").on(t.tripId),
    // KI-6: `listPages` seeds a trip's default pages when it sees zero rows.
    // Two concurrent first visits both observe zero rows, so the check alone
    // is not atomic — this partial unique index is what actually makes the
    // seed idempotent (the loser's INSERT ... ON CONFLICT DO NOTHING is a
    // no-op). Scoped to system-seeded rows so users stay free to name their
    // own pages anything, including "Trip Overview".
    uniqueIndex("pages_system_seed_unique")
      .on(t.tripId, t.title)
      .where(sql`${t.actorId} = 'system'`),
  ],
);

// ── Access & Membership (M11 link 3) ─────────────────────────────────────────
//
// Ordinary CRUD with audit fields, exactly as the AGENTS.md module map says:
// this module owns invites, roles and revocation and knows nothing about what a
// trip contains. It is NOT event-sourced — ADR-003 scopes the log to planning,
// and the mirror-image of that boundary is what keeps these two tables out of
// the event store rather than inventing `MemberAdded` planning events.
//
// The OWNER is deliberately not a row here. It is derived from the log's
// `TripCreated.createdBy` (`TripState.members`), which is what already makes
// every trip written in the eight milestones before this table existed work
// unchanged, with no backfill. `server/access/members.ts` merges the two.
export const tripMemberships = pgTable(
  "trip_memberships",
  {
    tripId: uuid("trip_id").notNull(),
    // A `users.id`, on the same no-foreign-key terms as `events.actor_id`
    // (ADR-025): the reference is upheld at the sign-in seam, and accepting an
    // invite requires a session, so every row here has a user row behind it.
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    invitedBy: text("invited_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.userId] }),
    index("trip_memberships_user").on(t.userId),
  ],
);

export const tripInvites = pgTable(
  "trip_invites",
  {
    id: uuid("id").primaryKey(),
    tripId: uuid("trip_id").notNull(),
    email: text("email"),
    role: text("role").notNull(),
    // The bearer credential (ADR-026). Stored as issued, not hashed, because
    // the owner's invite list has to be able to re-show a link they already
    // handed out; the only route that returns it requires `owner`.
    token: text("token").notNull(),
    status: text("status").notNull().default("pending"),
    invitedBy: text("invited_by").notNull(),
    // `mode: "date"`, not `"string"` — see the note above `savedDays` (KI-53).
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    acceptedBy: text("accepted_by"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("trip_invites_token").on(t.token),
    index("trip_invites_trip").on(t.tripId),
  ],
);

// Pinned read-only shares (M11 link 4, ADR-027). `seq` is the pin: the read
// replays the trip's first `seq` events instead of serving the materialized
// `trip_details` projection, which is what makes a link keep showing the trip
// as it was when it was created. Immutable once written — re-pinning is a new
// row, so a link already handed out can never change under the person holding
// it.
export const tripShares = pgTable(
  "trip_shares",
  {
    id: uuid("id").primaryKey(),
    tripId: uuid("trip_id").notNull(),
    token: text("token").notNull(),
    seq: integer("seq").notNull(),
    createdBy: text("created_by").notNull(),
    // `mode: "date"`, not `"string"` — see the note above `savedDays` (KI-53).
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [uniqueIndex("trip_shares_token").on(t.token), index("trip_shares_trip").on(t.tripId)],
);

// Saved parts (M11 link 6, ADR-029). A personal library of reusable day
// fragments — CRUD, owned by a person rather than by a trip, and not
// event-sourced (ADR-003 scopes the log to planning).
//
// `stops` is a jsonb array rather than a child table: a saved day is a
// value, copied in and copied out whole, never queried into. `source_trip_name`
// is a snapshot at save time, on the same terms as a trip's lineage (ADR-028) —
// the credit has to survive the source being renamed or deleted.
//
// The Access-module timestamps (here, `trip_invites`, `trip_shares`) are
// `mode: "date"` where the older tables are `mode: "string"`. `mode: "string"`
// hands the write path back exactly the ISO string it was given while the read
// path gets Postgres's own rendering ("2026-01-01 00:00:00+00"), so the same
// field had two shapes depending on whether you had just written the row —
// KI-53. `mode: "date"` makes the column a `Date` on both sides and each
// module's `toDto` does the one `.toISOString()` at the DTO boundary, so the
// shape is decided in one place instead of by which path you came in on. This
// is a client-side mapping only: the column stays `timestamptz` and no
// migration is involved.
export const savedDays = pgTable(
  "saved_days",
  {
    id: uuid("id").primaryKey(),
    // A `users.id`, on the same no-foreign-key terms as `events.actor_id`
    // (ADR-025).
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    // `$type` is a compile-time cast, NOT a runtime check — it says what the
    // write path intends and nothing about what the bytes are. The runtime
    // guarantee lives at the read boundary instead: `savedDays.ts`'s `fromRow`
    // parses this column with `SavedStop.array()` on every read, so a row
    // written before the contract moved is dropped-and-logged rather than
    // trusted (KI-71). Do not add a caller that reads `row.stops` directly.
    stops: jsonb("stops").$type<SavedStop[]>().notNull(),
    sourceTripId: uuid("source_trip_id").notNull(),
    sourceTripName: text("source_trip_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("saved_days_owner").on(t.ownerId)],
);

// Vendor-spend rate limiting (security review 2026-08-28, H1/L4). Not part of
// any module's domain data — it is infrastructure, disposable in the same sense
// projections are: dropping every row costs one window of over-permissiveness
// and nothing else.
//
// One row per bucket, not per bucket per window: `server/quota.ts` carries the
// window forward in the same upsert that increments, so row count is bounded by
// the number of actors and there is no expiry sweep. `bucket` is the primary
// key for exactly that reason — the atomic `ON CONFLICT DO UPDATE ... RETURNING`
// it enables is what makes the counter correct across concurrent serverless
// instances, where an in-memory counter caps nothing.
export const rateLimitCounters = pgTable("rate_limit_counters", {
  // "<policy>:user:<userId>" or "<policy>:global" — see server/quota.ts.
  bucket: text("bucket").primaryKey(),
  // `mode: "date"` — the Access-module convention, see the `savedDays` note (KI-53).
  windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
  hits: integer("hits").notNull(),
});
