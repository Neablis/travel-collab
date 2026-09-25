import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TripDetail, TripSummary } from "@tc/contracts";
import { db } from "@/server/db/client";
import { grantedMembersByTrip, mergeMembers } from "@/server/access/members";
import { listTripSummariesPage } from "@/server/projections";
import { orThrow, runCreation, tripDatesCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **Pilot endpoint 1 of 2** (M22 Phase 2) — a collection, so it is the one that
// exercises pagination, and the whole of its pagination cost is the `cursorOf`
// line below.
//
// Everything this file does NOT contain is the point: no `auth()`, no bearer
// parsing, no scope check, no 401 shape, no `WWW-Authenticate`, no rate limit,
// no `last_used_at`, no error envelope, no `?limit=` bounds, no cursor
// round-trip, no response validation. All of that is `route()`, once, for every
// endpoint that will ever exist.
export const { GET, POST } = route({
  GET: {
    summary: "List the trips you own or are a member of",
    scope: "trips:read",
    collection: {
      item: TripSummary,
      // Keyset, matching `listTripSummariesPage`'s ORDER BY. `tripId` is in the
      // key because `createdAt` alone ties, and a tied order is a pager that
      // silently loses rows.
      cursorOf: (trip: TripSummary) => `${trip.createdAt}|${trip.tripId}`,
    },
    handle: async ({ actor, page }) => {
      const rows = await listTripSummariesPage(actor.userId, page);
      // **The member overlay is kept, deviating from the design.** The design
      // called for *"a reshaped `GET /v1/trips`"* on the grounds that today's
      // version overlays members *"purely so the Home avatar stack renders"* —
      // true about its motive, and not a reason to publish a members list that
      // omits real members. This query already returns trips someone reaches
      // through a `trip_memberships` row; answering those with an owner-only
      // `members` array would be a wrong answer rather than a lean one. It costs
      // one batched read for the whole page, not one per trip.
      const granted = await grantedMembersByTrip(db, rows.map((r) => r.tripId));
      return rows.map((r) => ({
        ...r,
        members: mergeMembers(r.members, granted.get(r.tripId) ?? []),
      }));
    },
  },
  // **The first planning write, and the shape every other one follows.**
  //
  // What it costs beyond a read: one mapping — this body becomes a `CreateTrip`
  // — and nothing else. The server mints the id rather than taking one, because
  // a caller choosing its own primary key can collide with another account's
  // and can probe for which ids exist.
  //
  // **No trip dimension**, so a trip-scoped token is refused: creating a NEW
  // trip from a credential confined to two existing ones is a widening.
  POST: {
    summary: "Create a new trip that you own, optionally with a start date or a start and end date",
    scope: "trips:write",
    // `startDate`/`endDate` mean exactly what they mean on `PATCH
    // /v1/trips/{tripId}` — `tripDatesCommand` is that mapping, shared. Not
    // nullable: a trip being created has no dates to clear.
    body: z.object({
      name: z.string().min(1).max(200),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }),
    response: TripDetail,
    handle: async ({ actor, body }) => {
      const { name, startDate, endDate } = body as {
        name: string;
        startDate?: string;
        endDate?: string;
      };
      const tripId = randomUUID();
      // Throws the same 400 as PATCH for a date that is not on the calendar,
      // before anything is written.
      const dates = tripDatesCommand(tripId, { startDate, endDate }, { startDate: null, dayCount: 0 });
      // **One transaction, the trip and its dates** (KI-2026-09-19-f). The dates
      // command is decided against the trip `CreateTrip` has just made, inside
      // the same transaction, so every refusal it could give — an end date with
      // no start, an end before the start — is a 400 with the domain's own
      // message and no trip afterwards, not even a deleted one; and so is a
      // failure the caller did not send.
      return orThrow(await runCreation(actor, { type: "CreateTrip", tripId, name }, dates === undefined ? [] : [dates]));
    },
  },
});
