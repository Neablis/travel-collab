import { z } from "zod";
import { Conflict } from "./conflict.ts";
import { TripLineage, TripMember, TripStatus } from "./trip.ts";
import { ActivityKind, ActivitySnapshot, ActivityTag, Anchor, Location, TimeWindow } from "./activity.ts";
import { Money } from "./money.ts";

export const ActivityView = z.object({
  activityId: z.string().uuid(),
  title: z.string(),
  timeWindow: TimeWindow.nullable(),
  location: Location.nullable(),
  notes: z.string().nullable(),
  anchors: z.array(Anchor),
  // Defaulted, not required, for the same reason `forkedFrom` below is:
  // `trip_details.doc` is stored jsonb, and since KI-2026-09-05-r
  // `getTripDetail` parses it against this schema at the source rather than
  // handing it back raw for the read route to parse. Every document written
  // before M18 added these two fields has neither key, and a row is only
  // rewritten when its trip next changes — so a required `kind` 500s the
  // board for any trip nobody has touched since, which is exactly what it did
  // on the #71 preview (GET /api/trips/… → ZodError, `kind` Required).
  // Parsing at the source makes these defaults MORE load-bearing, not less:
  // they are now what lets an untouched pre-M18 row be read back at all.
  //
  // These are the same zero values the rest of the stack already agrees on:
  // `AddActivity.kind` is optional and documented "omitted = planned",
  // `ActivityAddedV1.payload` and `ActivityUpdatedV1.payload` both carry
  // `.default("planned")` and `.default([])`, and `state.ts` calls "planned"
  // the zero value outright. The read model was the one place that did not
  // apply them.
  kind: ActivityKind.default("planned"),
  tags: z.array(ActivityTag).default([]),
  cost: Money.nullable(),
  // M13 link 5, added by hand because this model is deliberately not derived —
  // the guard below forced the KEY and this line is the answer to it.
  //
  // **Looser than the snapshot's, on purpose, and that is this model's whole
  // rule**: a `bookedBy` naming somebody who has since left the trip, or a
  // `participants` entry that is no longer a member, must still READ. Those are
  // ordinary outcomes of membership changing under a stored document, and the
  // read path's job is to render the trip, not to re-litigate who belongs to
  // it. Membership is checked where it can be acted on — the command decider.
  bookedBy: z.string().nullable().default(null),
  participants: z.array(z.string()).default([]),
});
export type ActivityView = z.infer<typeof ActivityView>;

// KI-2026-09-05-o's compile-forcing, applied to the read model WITHOUT
// deriving it.
//
// `ActivityView` is deliberately not `ActivitySnapshot.shape` spread into an
// id. Deriving it would carry the snapshot's WRITE-path bounds — `title`
// 1..200, `notes` <=2000 — onto a model that parses `trip_details.doc`
// straight out of jsonb, where a stored value violating one does not fail a
// write, it 500s the board on read. That is the #71 shape (a required `kind`
// taking out every untouched pre-M18 trip), one field later, and the comment
// on `kind`/`tags` above is the record of paying for it once. The read model
// stays permissive on purpose. Decided by Mitchell, 2026-09-21.
//
// What the derivation WOULD have bought is bought here instead: add a ninth
// field to `ActivitySnapshot` without adding it below, and this alias stops
// satisfying its constraint and names this file. It is weaker than derivation
// in exactly one way, stated so nobody assumes otherwise — it forces the KEY
// to exist, not that its type matches the contract's. That is the price of
// keeping the read model loose, and it still turns the silent omission this
// KI is about into a build failure.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
export type ActivityViewCoversSnapshot = AssertTrue<
  Exact<keyof ActivitySnapshot, Exclude<keyof ActivityView, "activityId">>
>;

// The board read model: one document per trip, conflicts included.
export const TripDetail = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  status: TripStatus,
  startDate: z.string().nullable(),
  currency: z.string(), // ISO-4217, from state (default "USD")
  budget: Money.nullable(),
  members: z.array(TripMember).min(1),
  // Null for a trip that started from nothing (M11 link 5). Deliberately NOT
  // on TripSummary: the home grid's card says nothing about provenance, and
  // adding it there would mean a `trip_summaries` column and a migration for
  // a line of text the trip's own settings sheet already carries.
  //
  // `.default(null)` is what makes this additive against a LIVE database:
  // every `trip_details.doc` written before this change has no such key, and
  // those rows are only rewritten when their trip next changes. Without the
  // default, `TripDetail.parse` in the read route would 500 on every existing
  // trip until someone remembered to rebuild the projections.
  forkedFrom: TripLineage.nullable().default(null),
  days: z.array(
    z.object({
      dayId: z.string().uuid(),
      activityIds: z.array(z.string().uuid()),
      date: z.string().nullable(),        // M3
      costSubtotal: z.number().int(),     // M4 (minor units)
    }),
  ),
  backlog: z.array(z.string().uuid()),
  activities: z.record(ActivityView),
  conflicts: z.array(Conflict),
  dismissedConflictIds: z.array(z.string()), // sorted; ids are content-derived
  createdAt: z.string(), // ISO 8601, from the first envelope
  unscheduledCostSubtotal: z.number().int(),
  tripCostTotal: z.number().int(),
  budgetRemaining: z.number().int().nullable(), // budget − total, null if no budget (may be negative)
});
export type TripDetail = z.infer<typeof TripDetail>;
