import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
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
import type {
  DistanceUnit,
  GrantSource,
  PlanId,
  Origin,
  SavedDayAuthorKind,
  SavedDayVisibility,
  SavedStop,
  SubscriptionStatus,
  TripDetail,
  TripMember,
  PageContent,
  PageContext,
} from "@tc/contracts";

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
  // M17: the preference columns. Separate from `name`/`email`/`image` above,
  // which the sign-in callback overwrites from the OAuth provider on EVERY
  // sign-in — `upsertUser`'s `onConflictDoUpdate` enumerates its `set` list by
  // hand, so these three are absent from it and a name someone typed is not
  // clobbered the next time they sign in with Google. That absence is the
  // whole reason `display_name` is its own column rather than a reuse of
  // `name`; `users.int.test.ts` writes one and runs `recordSignIn` over it.
  displayName: text("display_name"),
  // Uppercase IATA, validated at the route (UserPreferences), never resolved:
  // no airport dataset ships with the app.
  homeAirport: text("home_airport"),
  // Defaulted in the DATABASE, not in the reader: `UserPreferences` has no
  // unset state for this field, so a row must always carry one and no caller
  // ever picks a fallback. `$type` is a compile-time cast only — the read
  // boundary in `server/users.ts` parses it, same as `savedDays.fromRow`.
  distanceUnit: text("distance_unit").$type<DistanceUnit>().notNull().default("km"),
  // M20 link 2 — WHAT THIS ACCOUNT HOLDS. The Entitlements module's second
  // store (ADR-045 rule 1): the committed plan file says what a plan *is*,
  // these two columns say which one this account *has*.
  //
  // Two columns rather than one composite string because Phase 6's console
  // groups by plan ("accounts per plan") and a `LIKE 'premium@%'` is not a
  // grouping. `planVersionRefOf` composes the `PlanVersionRef` the contracts
  // schema validates; nothing stores the composed form.
  //
  // **`plan_version` is a reference that must resolve or fail loudly**
  // (ADR-045 rule 3) — never a silent fall back to the newest entry and never
  // an empty entitlement set. A pinned version whose entry was deleted is the
  // one failure mode the committed-file move introduced, which is why
  // published entries are append-only and never removed.
  planId: text("plan_id").$type<PlanId>().notNull().default("free"),
  // The SQL default is a floor for a row inserted by hand or by a migration,
  // NOT the mechanism. `upsertUser` passes `livePlanVersion("free")`
  // explicitly on insert, which is what makes *"a new account gets v2"* true
  // once v2 is published — a column default frozen at `1` would hand every
  // future signup v1 forever.
  planVersion: integer("plan_version").notNull().default(1),
  // The operator bit. There is no global role concept in this product and this
  // is deliberately not one: it is a single boolean gating an operator tool,
  // not the first rung of a permission ladder. Per-trip roles stay `TripRole`.
  isAdmin: boolean("is_admin").notNull().default(false),
  // M21 link 1 — **the Stripe customer this account is, once it has been one.**
  //
  // Null until the first checkout, and then permanent: a customer outlives
  // every subscription it ever had, which is what makes "open the portal for
  // this account" answerable after a cancellation. Deleting it on lapse would
  // orphan the invoice history the portal exists to show.
  //
  // **On `users` rather than on `subscriptions`** because the relationship is
  // one customer per account for the account's whole life, while subscriptions
  // come and go. Storing it on the subscription would give an account that
  // cancelled and resubscribed two customer ids and two invoice histories, and
  // the second one would look like a new person to Stripe.
  //
  // Written by the checkout route, not by the webhook. That is not a breach of
  // link 4's *the webhook is the sole writer*: a customer id is who you are at
  // Stripe, not what you are entitled to, and it has to exist before a
  // Checkout Session can be created for it. `subscriptions` and `users.plan_id`
  // — the two things that decide what an account may do — stay the webhook's
  // alone, and `billing.soleWriter.test.ts` sweeps for exactly those two.
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

// **Who holds what they did not buy** (M20 link 2, ADR-045 rule 1).
//
// Trials, referral rewards, founder grants and admin comps are not four
// features. They are ONE time-bounded grant with four values in `source`,
// resolved by one function — the collapse M20's *The shape* rests on, and the
// whole reason the milestone is small enough to be one.
//
// **A grant pins a version and never restates what it grants** (ADR-045 rule
// 1). `plan_id` + `plan_version` is the pin; the entitlements come from that
// entry in the committed file. Storing the list here too would let the two
// disagree, and the stored copy would win silently.
//
// **No foreign keys**, per the schema's standing convention — every user
// reference in this file is a bare `text` upheld at the sign-in seam
// (ADR-025), and this table follows it rather than introducing the repo's
// first FK.
//
// **Not event-sourced.** Invariant 1 scopes the log to planning; this is
// Identity-adjacent CRUD with audit fields, the same reasoning ADR-003 and
// ADR-029 applied.
//
// **NOTHING MAY DELETE OR SWEEP THIS TABLE.** The trial is one time ever per
// account (Mitchell, 2026-09-13) and eligibility asks *"has this account EVER
// held a trial grant"* — a question only the row can answer, read with
// `expires_at` and `revoked_at` ignored. A cleanup job that removes expired
// rows hands a second trial to everyone who ever had one, and it looks like
// generosity rather than a bug. `grants.retention.test.ts` fails if one is
// added.
export const entitlementGrants = pgTable(
  "entitlement_grants",
  {
    id: uuid("id").primaryKey(),
    // A `users.id`, on the same no-foreign-key terms as `events.actor_id`.
    userId: text("user_id").notNull(),
    planId: text("plan_id").$type<PlanId>().notNull(),
    planVersion: integer("plan_version").notNull(),
    source: text("source").$type<GrantSource>().notNull(),
    // Who did it, when a person did. Null for `trial` (issued by signup) and
    // `referral` (issued by a redemption) — there is no operator behind either,
    // and naming one would be a lie in an audit column.
    grantedBy: text("granted_by"),
    // Why, in the operator's words. Link 7: grant *"with an expiry and a
    // reason"* — a comp nobody can explain six months later is a billing
    // dispute with no evidence.
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    // Null is PERMANENT, which is what a founder grant is. Expiry is resolved
    // on read, never swept: the gate box requires the next request after
    // expiry to be refused with *"nothing revoked by hand and no job run"*.
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: text("revoked_by"),
  },
  (t) => [
    // Every read is "this account's grants", and there is exactly one.
    index("entitlement_grants_user").on(t.userId),
    // **The one-time-ever trial, made true by construction.** An application
    // read-then-write can race two concurrent sign-ins into two trials; a
    // partial unique index cannot. The insert is `ON CONFLICT DO NOTHING`, so
    // the second attempt is a no-op rather than an error — a returning account
    // simply does not get another week.
    //
    // Partial on `source`, so the other three sources are unconstrained: an
    // account may hold many admin comps and many referral rewards.
    uniqueIndex("entitlement_grants_one_trial_ever")
      .on(t.userId)
      .where(sql`${t.source} = 'trial'`),
    // Phase 6's console counts *accounts per active grant source*, which scans
    // by source and filters on the two lifecycle columns.
    index("entitlement_grants_source").on(t.source),
  ],
);

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
  // `$type<T>()` IS A CAST, NOT A GUARANTEE (KI-2026-09-05-r). Drizzle applies
  // no runtime check: it relabels `unknown` as `TripDetail` for the compiler
  // and nothing else, so a `doc` written by an older version of the contract —
  // or by hand — is typed `TripDetail` while satisfying none of it. Reading
  // this column is therefore only safe through `getTripDetail`, which parses;
  // a `db.select().from(tripDetails)` written anywhere else re-opens the hole.
  // The same caveat applies to every `$type` in this file.
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
    // The cities this day touches, derived from `stops` at SAVE time by
    // `citiesOfStops` (@tc/domain) — a snapshot, exactly like
    // `source_trip_name` below (M11b link 1).
    //
    // Its own column, and this is the whole point: `stops` is jsonb because a
    // saved day is a value that is never queried into (ADR-029), and Discover
    // has to ask "which days contain Kyoto" on every keystroke. Deriving it
    // per query would query into the thing the ADR says is not queried into.
    //
    // `text[]`, not jsonb: this column exists to be searched by containment,
    // and `cities && ARRAY['Kyoto']` over a real array with a GIN index is the
    // operation link 5 ranks on ("a day matches on ANY city it contains").
    // Defaulted to the empty array so the migration that adds it lands on
    // existing rows without a rewrite; the backfill then fills them in.
    cities: text("cities").array().notNull().default([]),
    // Private by default (M11b link 3) — the default is the guarantee, not a
    // convention the publish endpoint has to remember. Every row that existed
    // before this column did is private, and a future writer that forgets the
    // field gets private too.
    //
    // `text` with a `$type` rather than a pg enum, matching `trip_invites`
    // and `trip_shares`' `status`. See `SavedDayVisibility` in
    // packages/contracts for why the CONTRACT is an enum rather than a
    // boolean; the column follows the contract's spelling so the two never
    // need a mapping table between them.
    visibility: text("visibility").$type<SavedDayVisibility>().notNull().default("private"),
    // **Who wrote this day** — `"human"` or `"ai"` (Mitchell, 2026-09-06:
    // *"we will need to indicate in the database when its a human playbook or a
    // AI seed data"*). See `SavedDayAuthorKind` in packages/contracts for why
    // the contract is an enum rather than a boolean, why the two values are
    // about AUTHORSHIP rather than about how the row got here, and why it is
    // not called `origin` — `events.origin` above already means something else
    // entirely.
    //
    // `text` with a `$type` rather than a pg enum, following `visibility`
    // directly above and `trip_invites.status` before it — the column follows
    // the contract's spelling so the two never need a mapping between them.
    //
    // **Defaulted to `'human'`, and the default is the guarantee.** Every row
    // that existed before this column did was written by a person through
    // `POST /api/saved-days`, and so is every row that route writes now; only
    // the content importer passes anything else, and it passes it explicitly.
    // A future writer that forgets the field gets the truthful answer rather
    // than a claim nobody made.
    authorKind: text("author_kind").$type<SavedDayAuthorKind>().notNull().default("human"),
    // Which content bundle imported this row, or null for a day a person saved.
    //
    // Re-import was already idempotent — ids derive from (bundle.id, key), so a
    // write replaces exactly what it wrote before. What it could not see was a
    // REMOVAL: a playbook deleted from a bundle left a row nothing could
    // identify. This makes "everything from bundle X minus what X now declares"
    // an answerable question, which is the whole of `--prune`.
    //
    // Nullable on purpose. Rows written by people have no bundle, and NULL says
    // that rather than inventing a sentinel — which is also what keeps them out
    // of the prune, since it only ever looks at rows where this is set.
    sourceBundle: text("source_bundle"),
    // The denormalised counter over `saved_day_adds` (M11b link 4). The LEDGER
    // is the authority and this is recomputable from it
    // (`count(*) where saved_day_id = ?`) — it exists so the leaderboard and
    // every Discover card can rank and render without an aggregate per row.
    // Nothing may increment it except the path that inserts a ledger row, or
    // the two disagree and the board's credibility goes with them.
    adds: integer("adds").notNull().default(0),
    // When this day was last made public — null while it is private, set when
    // `visibility` flips to "public", cleared on unpublish. The two only ever
    // move together, in `setSavedDayVisibility` and nowhere else.
    //
    // It exists because Discover's "newest" sort has nothing else honest to
    // read. `created_at` is SAVE time, so a day kept in June and published this
    // morning would sort as June, six weeks below days nobody could see yet —
    // on the one sort whose whole job is to surface what has just arrived.
    // Nullable rather than defaulted, because "never published" is a real state
    // and a default would have to invent a date for it.
    //
    // `mode: "date"` — see the `savedDays` note above (KI-53).
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    // A SOFT delete: when the owner removes this day from their library, the
    // row stays and this takes the moment. Mitchell, 2026-09-01: *"add a button
    // to delete a notebook activity you own ... for now we can even just add a
    // new db column deletedAt and set the deleted at date, and set a filter to
    // not return deletedAt activities so we have a way to restore in the
    // future"* — the restore path is the whole reason the row survives, and
    // there is no code that writes it back to null yet.
    //
    // **Nullable, never defaulted, and no backfill.** "Never deleted" is a real
    // state and a default would have to invent a date for it — the same
    // argument `published_at` above makes for itself.
    //
    // **This does NOT unwind anything.** The adds ledger keeps every row, and a
    // copy already taken into somebody's trip stays in their trip: an inserted
    // day is a VALUE, minted with fresh ids into that trip's own event stream
    // (ADR-029, and `insertCommands`' remapping), so there is nothing pointing
    // back here to remove. Mitchell's words for the same rule: *"it doesn't
    // remove it from anyone, it just removes it here."*
    //
    // **Every read filters on it, and missing one is the whole risk.** The list
    // is in `savedDays.ts` (`listSavedDays`, `getSavedDay`, `readableSavedDay`,
    // `setSavedDayVisibility`), `playbooks.ts` (`matchPredicate`, which covers
    // Discover and the sibling chips, plus `publishedDayCount`, `leaderboard`,
    // `publicAuthor` and `citiesKnownBy`) and `cities.ts` (`searchCities`). A
    // deleted day must 404 exactly the way a private one does — see
    // `access/saved-day-access.ts` on why those two answers must be the same.
    //
    // `mode: "date"` — see the `savedDays` note above (KI-53).
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    sourceTripId: uuid("source_trip_id").notNull(),
    sourceTripName: text("source_trip_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    index("saved_days_owner").on(t.ownerId),
    // GIN, because every read of this column is a containment test
    // (`cities && ARRAY[...]`) and btree cannot serve one. It ships with the
    // column rather than with its first query: the column has exactly one
    // reason to exist, and adding the index later means a second migration
    // for a table whose access pattern was known when it was designed.
    index("saved_days_cities").using("gin", t.cities),
  ],
);

// The adds ledger (M11b link 4). One row per (saved day, trip) — the day
// somebody took, and the trip they took it into.
//
// **A table, not an `adds++`.** The rule: *an add only counts once per trip;
// copying your own day into your own trip does not count.* A build that counts
// raw inserts produces a different and gameable order, and the leaderboard's
// whole credibility is that rule holding — so the ledger records what was added
// and `saved_days.adds` is derived from it, never the other way round. (The
// design's copy had a third clause, *and only after the trip has dates*;
// Mitchell dropped it on 2026-09-08 and an add into an undated trip now counts.
// `savedDayAdds.ts` carries the reasoning.)
//
// **The composite primary key is the "once per trip" half of that rule, made
// true by construction.** Inserting the same day into the same trip twice
// raises a unique violation at the database rather than depending on an
// application read-then-write that a future caller could forget, or lose a
// race with. The other clause — the author is not their own audience — is a
// fact about a day and an actor, not about this table, so it stays in the write
// path (PR2) where those values are in hand.
//
// `added_by` is recorded but does not key anything: it is what makes "copying
// your own day into your own trip does not count" auditable after the fact,
// and what a future "days you have taken" surface would read. No index on it
// yet — no query asks, and `invite_codes` above sets the precedent for not
// indexing one that nobody makes.
export const savedDayAdds = pgTable(
  "saved_day_adds",
  {
    savedDayId: uuid("saved_day_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    // A `users.id`, on the same no-foreign-key terms as `events.actor_id`
    // (ADR-025).
    addedBy: text("added_by").notNull(),
    // `mode: "date"` — see the `savedDays` note above (KI-53).
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  // No separate index on `saved_day_id`: the primary key leads with it, so
  // "how many times was this day added" already has one.
  (t) => [primaryKey({ columns: [t.savedDayId, t.tripId] })],
);

// Single-use admission codes (M11a link 4). The invite gate's third way
// through: a code minted by hand, handed to one person, and burned when they
// sign in. That is what makes this an invite system rather than a shared
// password — a leaked code admits one account, and the row records who came in
// on whose invitation.
//
// `code` is the primary key, not a surrogate id with a unique index. The only
// query on the redemption path is "claim the row for exactly this string", and
// making the string itself the key is what makes the conditional
// `UPDATE ... WHERE code = ? AND redeemed_by IS NULL RETURNING` in
// `server/admission.ts` a single indexed statement with nothing to race
// against — the same construction `acceptInvite` already uses on
// `trip_invites.token`.
//
// **No secondary index, deliberately.** The obvious candidates would serve
// "which codes did I issue" (`created_by`) and "who did I let in"
// (`redeemed_by`), and neither has a caller: invite-code administration is
// explicitly out of M11a's scope (codes are minted by hand), so both would
// index a query nobody makes, on a table with one row per invited person. Add
// one when the surface that reads it exists.
export const inviteCodes = pgTable("invite_codes", {
  code: text("code").primaryKey(),
  // A `users.id`, on the same no-foreign-key terms as `events.actor_id`
  // (ADR-025). Today it is whoever ran the INSERT by hand.
  createdBy: text("created_by").notNull(),
  // `mode: "date"` — the Access-module convention, see the `savedDays` note (KI-53).
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  // Null until redeemed. This column IS the single-use guarantee: the claim is
  // conditional on it still being null, so two concurrent sign-ins with the
  // same code produce exactly one winner without a transaction or a lock.
  redeemedBy: text("redeemed_by"),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true, mode: "date" }),
});

// **What an account costs** (M20 link 9). One row per AI request.
//
// **Tokens and model ids, never dollars.** Prices move — DeepSeek's rates for
// the configured model changed on 2026-08-16, mid-scoping, and the milestone's
// own cost table was wrong by 1.7x on input and 2.5x on output until it was
// corrected against the live catalogue. A stored dollar figure freezes one
// price into history, cannot be re-derived, and silently corrupts the series
// the day a model changes. Tokens plus a dated rate record re-price history
// correctly and survive a model swap.
//
// **`Money` must not be used for this**, and the reason is arithmetic rather
// than taste. ADR-008 defines `Money` in integer minor units — whole cents for
// USD — and a live request costs **$0.0006**, six hundredths of a cent, which
// rounds to **zero**. Every request would record as free. That is the KI-1 /
// KI-14 / `budgetPerPerson` defect class on its third recurrence, and
// `aiUsage.noMoney.test.ts` fails if a currency type or a dollar column
// appears anywhere on this path.
//
// **Turn and classifier tokens stay separate, permanently.** *"Did the
// classifier save more than it cost"* is unanswerable if its spend is folded
// into the turn's, and the whole reason the classifier has its own model id is
// that the question is worth asking.
//
// **No question text and no trip content.** `askAnalytics` already logs the
// question to the console deliberately; a durable table is the wrong place for
// it, and this table has no column one could be written to.
//
// CRUD, not evented (invariant 1) — this is not planning state.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey(),
    // A `users.id`, on the same no-foreign-key terms as `events.actor_id`.
    userId: text("user_id").notNull(),
    /** `ask` or `ask.apply` — `TurnCost.endpoint`. */
    endpoint: text("endpoint").notNull(),
    /** `completed` | `error` | `abort`. A turn that failed partway still has a row. */
    outcome: text("outcome").notNull(),
    taskClass: text("task_class").notNull(),
    // **The RESOLVED model id, never a compiled default.** `config.ts` compiles
    // `anthropic/claude-haiku-4-5` while production sets `AI_MODEL` to
    // `deepseek/deepseek-v4-flash-0731`, and costing the compiled default
    // overstates the bill by roughly an order of magnitude — a mistake made
    // once already while scoping this milestone. Storing what actually ran is
    // what makes it unavailable to any later analysis.
    turnModel: text("turn_model").notNull(),
    // Null means the provider reported no usage. **Never zero**, which is a
    // measurement — a turn that really used no tokens and a turn nobody
    // measured are different facts and a rate join must be able to tell them
    // apart.
    turnTokensIn: integer("turn_tokens_in"),
    turnTokensOut: integer("turn_tokens_out"),
    // Null when no classification round-trip was made at all: a bare "yes go
    // ahead" short-circuits the classifier, and a page turn is never
    // classified. Neither has a round-trip to price.
    classifierModel: text("classifier_model"),
    classifierTokensIn: integer("classifier_tokens_in"),
    classifierTokensOut: integer("classifier_tokens_out"),
    /** The agent's own round-trips. The classifier's is the column above. */
    steps: integer("steps").notNull(),
    // Which per-user ceiling was in force. A purchase PINS a version, so this
    // is not derivable from `created_at`: two accounts billing on the same day
    // can sit on different versions.
    planVersionRef: text("plan_version_ref"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    // Every question the console asks is "this account, over this window" or
    // "every account, over this window", and both lead with time.
    index("ai_usage_user_created").on(t.userId, t.createdAt),
    index("ai_usage_created").on(t.createdAt),
  ],
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

// **What an account pays for** (M21 link 1).
//
// The Billing module's only store. It holds what Stripe told us, pinned to the
// plan version that was bought — and it says nothing about what an account may
// DO. That question is the Entitlements resolver's, exactly as it was before
// this milestone: M21 adds no entitlement and no gate.
//
// **One writer, and it is the webhook** (M21 link 4). Nothing else in the
// product inserts or updates a row here. A checkout redirect is a hint, never a
// grant — a client returning from Stripe proves only that a browser followed a
// URL, and deriving entitlement from a success URL is the classic way a paywall
// becomes free. `billing.soleWriter.test.ts` sweeps the tree for a second
// writer of this table or of `users.plan_id`.
//
// **`plan_id` + `plan_version` is a pin, not a description** — the same
// convention `entitlement_grants` follows and for the same reason (ADR-045
// rule 1). What `plus@v1` grants and what it costs both come from the committed
// plan file; storing either here would let the two disagree, and the stored
// copy would win silently. It is what makes M21 link 2's *what you bought is
// what you get* true: republishing `plus` at a new price leaves this row
// pointing at the version this subscriber actually agreed to.
//
// **No foreign keys**, per the schema's standing convention (ADR-025).
//
// **Not event-sourced.** Invariant 1 scopes the log to planning.
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey(),
    // A `users.id`, on the same no-foreign-key terms as every other user
    // reference in this file.
    userId: text("user_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    // Stripe's `sub_...`. Unique, and that uniqueness is what makes the webhook
    // idempotent at the row level as well as at the event level: two deliveries
    // of the same subscription's events cannot produce two rows.
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    planId: text("plan_id").$type<PlanId>().notNull(),
    planVersion: integer("plan_version").notNull(),
    // Stripe's own word, stored verbatim — see `SubscriptionStatus` in
    // contracts for why this is a transcription rather than a model.
    status: text("status").$type<SubscriptionStatus>().notNull(),
    // **Reconciled from the event's own data, never from arrival sequence**
    // (M21 link 4's ordering tolerance). This is the period end Stripe reported
    // on the subscription object in the event that was applied, which is what
    // the account sheet renders as the renewal date and what a cancellation
    // runs to.
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: "date" }),
    // Cancelling sets this rather than ending anything (M21 link 5). Access
    // runs to `current_period_end` and then lapses through M20's resolver —
    // there is deliberately no second downgrade path to keep in sync.
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    // **When the card was declined** — the anchor for M21 link 6's grace
    // window, which is measured from the decline and NOT from the period end.
    //
    // Its own column rather than derived from `status`, because the window is
    // three days and Stripe's own retry schedule spreads several attempts over
    // about two weeks: a `past_due` subscription can sit in that status far
    // longer than the window, and "how long has this been failing" is a
    // question `status` cannot answer. Cleared the moment a payment succeeds,
    // so a card fixed inside the window costs the account nothing.
    pastDueSince: timestamp("past_due_since", { withTimezone: true, mode: "date" }),
    // **The `created` of the newest Stripe event applied to this row.**
    //
    // The whole of the out-of-order defence, and it is a comparison rather than
    // a sequence number because Stripe issues no sequence. Events arrive in any
    // order and a stale one must not overwrite a fresh one; an event older than
    // this is dropped, an event at exactly this timestamp is applied (two
    // events can share a second, and dropping the second would lose a real
    // transition). See `applyStripeEvent`.
    lastEventAt: timestamp("last_event_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    uniqueIndex("subscriptions_stripe_subscription").on(t.stripeSubscriptionId),
    // "What does this account pay for" — the account sheet's read, on every
    // load of the Plan section.
    index("subscriptions_user").on(t.userId),
    // "What is every live subscription worth" — link 7's MRR, which scans by
    // status and is the only query here that is not about one account.
    index("subscriptions_status").on(t.status),
  ],
);

// **Every Stripe event this deployment has already applied** (M21 link 4's
// idempotency).
//
// Stripe retries a delivery until it gets a 2xx, and a retry of an event we
// already applied must not apply it twice — a redelivered
// `customer.subscription.updated` is harmless, a redelivered one that moved a
// period end is not, and there is no class of event where double-applying is
// *guaranteed* to be safe. So the check is on the event, not on the effect.
//
// **The insert is the lock.** `INSERT ... ON CONFLICT DO NOTHING` returning no
// row means "someone already has this one" — an atomic claim that works across
// concurrent serverless invocations, where a read-then-write would not. It is
// the same reasoning `rate_limit_counters` gives for its own upsert.
//
// **Nothing sweeps this table**, for the same reason nothing sweeps
// `entitlement_grants`: the row IS the idempotency guarantee, and deleting old
// rows re-opens replay for exactly the events old enough that nobody is
// watching. Stripe retries for up to three days; the rows are small and the
// volume is one per billing event per account.
export const billingEvents = pgTable("billing_events", {
  // Stripe's `evt_...`, verbatim. The primary key IS the idempotency key.
  id: text("id").primaryKey(),
  // What kind of event it was, for reading the table back when something looks
  // wrong. Never branched on after the fact — the handler did that at the time.
  type: text("type").notNull(),
  // Stripe's `created` on the event, which is what the ordering check above
  // compares. Stored so that "what did we apply and in what order" is
  // answerable from this table alone.
  eventAt: timestamp("event_at", { withTimezone: true, mode: "date" }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull(),
  // **When the work finished — null while a delivery is still in flight.**
  //
  // The claim alone was not enough, and the gap it left was the worst one in
  // this milestone. `claimEvent` writes this row BEFORE any work runs. If a
  // later step threw — `retrieveSubscription`, the insert, `syncHeldPlan` — the
  // route answered 500, Stripe retried the same event id, the claim said
  // "already have it", and the effect was never applied. For
  // `checkout.session.completed` that is terminal: the `client_reference_id`
  // naming the account appears on no later event, so a paid account sits on
  // `free` with no retry path left.
  //
  // With this column a claim is provisional: a conflicting row that never
  // completed is re-claimable, and only a row stamped here is a true replay.
  // CodeRabbit, PR #177.
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }),
});
