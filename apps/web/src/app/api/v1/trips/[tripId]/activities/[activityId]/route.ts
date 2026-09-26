import { z } from "zod";
import {
  clearDetailFieldsForKind,
  GEOCODE_OUTCOME_END_HEADER,
  GEOCODE_OUTCOME_HEADER,
  TripDetail,
  UpdateActivity,
} from "@tc/contracts";
import { tripRegionOf } from "@/server/geocoding/region";
import { orThrow, refuseUnparseable, runBatch, runCommand, type CommandInput } from "@/server/public-api/commands";
import { GEOCODE_OUTCOME_DOC, GEOCODE_OUTCOME_END_DOC, resolveStopPlaces } from "@/server/public-api/locations";
import { route } from "@/server/public-api/route";

// **The endpoint Decision 14 is about.**
//
// Mitchell, 2026-09-16: *"Follow rest, you dont need to make opinions about
// whats actually happening a patch is a patch."* An activity is a resource with
// fields; whether the fields sent are `title` and `cost`, or `dayId` and
// `position`, or all four, is not the API's business.
//
// That `UpdateActivity` and `MoveActivity` are two commands internally is OUR
// implementation detail, and this is the same principle that kept the command
// envelope unpublished: the public surface does not leak our vocabulary.
//
// **A patch touching both halves composes one batch**, which is already
// all-or-nothing — so "these land together or not at all" costs nothing to
// promise.
const PatchStopBody = UpdateActivity.omit({ type: true, tripId: true, activityId: true, placeRef: true })
  .extend({
    // The move half, in the same flat object. `dayId: null` is the backlog.
    dayId: z.string().uuid().nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();

export const { PATCH, DELETE } = route({
  PATCH: {
    summary: "Edit a stop's details, or move it to another day, position or the backlog",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    body: PatchStopBody,
    response: TripDetail,
    responseHeaders: { [GEOCODE_OUTCOME_HEADER]: GEOCODE_OUTCOME_DOC, [GEOCODE_OUTCOME_END_HEADER]: GEOCODE_OUTCOME_END_DOC },
    handle: async ({ actor, params, body, trip, responseHeaders }) => {
      const { dayId, position, ...fields } = body as {
        dayId?: string | null;
        position?: number;
      } & Record<string, unknown>;
      const tripId = params["tripId"]!;
      const activityId = params["activityId"]!;
      const commands: CommandInput[] = [];
      if (Object.keys(fields).length > 0) {
        // A patch that changes `kind` clears the details the new kind cannot
        // carry (a `pendingReason` off pending, a leg off transit) unless it
        // names them — the decider refuses a stray one rather than dropping it,
        // so `{ kind: "planned" }` alone was a 400 on every stop created as
        // "To book" (ADR-055, "Callers").
        commands.push({ ...clearDetailFieldsForKind(fields), type: "UpdateActivity", tripId, activityId } as CommandInput);
      }
      if (dayId !== undefined || position !== undefined) {
        // **An omitted `dayId` is not the backlog.** `MoveActivity` names both
        // halves, so a `PATCH { position }` has to supply a day — and `?? null`
        // supplied the backlog, quietly pulling a stop off the day it was on
        // when all the caller asked for was a reorder. `null` still MEANS the
        // backlog; it just has to be asked for.
        const currentDayId = trip!.days.find((d) => d.activityIds.includes(activityId))?.dayId ?? null;
        commands.push({
          type: "MoveActivity",
          tripId,
          activityId,
          // A move names both halves; a patch may name one. `position: 0`
          // appends to the front, which is the only sensible default for "put
          // it on this day" with no position given.
          toDayId: dayId === undefined ? currentDayId : dayId,
          position: position ?? 0,
        });
      }
      // Refused before anything is looked up when the body alone decides it — a
      // travel leg beside a non-transit `kind` (M24). A leg with no `kind` in
      // the body depends on the stored stop, so that one is the decider's.
      refuseUnparseable(commands);
      // Only a place the caller actually sent is resolved: `location: null`
      // clears the stop's pin and an absent one leaves it alone, so neither
      // spends a geocode. `resolveStopPlaces` holds that rule for both places.
      if (commands[0]?.type === "UpdateActivity") {
        const ctx = { userId: actor.userId, region: tripRegionOf(trip!) };
        commands[0] = await resolveStopPlaces(commands[0], ctx, responseHeaders);
      }
      return orThrow(await runBatch(actor, commands));
    },
  },
  DELETE: {
    summary: "Remove a stop from a trip",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    response: TripDetail,
    handle: async ({ actor, params }) =>
      orThrow(
        await runCommand(actor, {
          type: "RemoveActivity",
          tripId: params["tripId"]!,
          activityId: params["activityId"]!,
        }),
      ),
  },
});
