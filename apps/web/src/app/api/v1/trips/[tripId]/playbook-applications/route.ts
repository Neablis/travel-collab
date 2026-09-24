import { z } from "zod";
import { insertSavedDay } from "@/server/savedDays";
import { readStreamHeadSeq } from "@/server/eventStore";
import { db } from "@/server/db/client";
import { orThrow, PublicApiError, refusal } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";
import {
  ApplicationWarning,
  applicationWarnings,
  logApply,
  type ApplyLogRecord,
} from "@/server/public-api/applications";

// **Apply a Playbook to a trip** (ADR-050): its days appended at the end, every
// stop on the day it belongs to — `insertSavedDay`, the one construction the
// app's own "Add to a trip" calls, over v1.
//
// **Pass B** (ADR-050): a `version` pin, an `expectedTripSeq` precondition the
// batch itself checks, `startingAt` placement that merges onto existing days,
// `Idempotency-Key` (ADR-051), and `warnings`. A bare `{ playbookId }` still
// appends exactly as Phase 1 did.
//
// **A noun because REST wants one.** Applying creates days and stops; the
// application is the record of that, and `POST` of one is the create. There is
// nothing to `GET` back — the result is the trip, which already has its own URL.
//
// **One batch, so one history entry and one undo**, and ids minted fresh per
// application so the same Playbook can go into one trip twice. Nothing about
// the source trip — its dates, its ids — comes across; a `SavedStop` never
// carried either.

const Placement = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("append") }).strict(),
    z
      .object({
        mode: z.literal("startingAt"),
        dayId: z
          .string()
          .uuid()
          .describe("A day already in the trip. The Playbook's day 0 goes onto it, day 1 onto the next, and so on."),
      })
      .strict(),
  ])
  .describe(
    "`append` (the default) adds every Playbook day at the end of the trip. `startingAt` merges: " +
      "Playbook day k goes onto the trip day k places after `dayId`, and only the days that run past " +
      "the end of the trip are added.",
  );

const Body = z.object({
  playbookId: z.string().uuid(),
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Apply only if the Playbook is still at this `version`; otherwise 409 with `details.currentVersion`."),
  placement: Placement.optional(),
  expectedTripSeq: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Apply only if the trip still stands at this revision (the `historySeq` a previous write answered, " +
        "or the newest history entry's `toSeq`); otherwise 409 with `details.currentSeq`. Checked in the same " +
        "transaction as the write.",
    ),
});
type Body = z.infer<typeof Body>;

const Application = z.object({
  tripId: z.string().uuid(),
  playbookId: z.string().uuid(),
  playbookVersion: z.number().int().positive().describe("The Playbook `version` that was applied."),
  dayIds: z
    .array(z.string().uuid())
    .describe(
      "Per Playbook day, in order, the trip day it landed on — new days on an append; existing days, " +
        "then any new ones, on a `startingAt` merge. Empty days included.",
    ),
  createdDayIds: z
    .array(z.string().uuid())
    .describe("Only the days this application added, in order. Equal to `dayIds` on an append."),
  activityIds: z
    .array(z.string().uuid())
    .describe("The new stops' ids, in the same order as the Playbook's `stops`."),
  historySeq: z
    .number()
    .int()
    .positive()
    .describe(
      "The revision the trip stands at after this application (its history entry's `toSeq`). " +
        "The whole application is that one entry, so one undo removes all of it.",
    ),
  warnings: z
    .array(ApplicationWarning)
    .describe(
      "Advice, never a refusal: nothing is dropped because of one. `conflict` is a conflict this " +
        "application introduced that involves a new stop; `weekday-mismatch` is a stop anchored to " +
        "weekdays that landed on a dated day that is none of them.",
    ),
});

/** Ids and counts for the log line, never a title or a note. */
type Logged = Omit<ApplyLogRecord, "event" | "outcome" | "reason" | "status">;

function unapplied(userId: string, tripId: string, body: Body): Logged {
  return {
    userId,
    tripId,
    playbookId: body.playbookId,
    placement: body.placement?.mode ?? "append",
    playbookVersion: null,
    dayCount: null,
    createdDayCount: null,
    activityCount: null,
    warningCount: null,
    historySeq: null,
  };
}

/** Log the refusal, then throw it for `route()` to render. */
function reject(logged: Logged, reason: string, error: PublicApiError): never {
  logApply({ ...logged, outcome: "rejected", reason, status: error.status });
  throw error;
}

export const { POST } = route({
  POST: {
    summary: "Apply a Playbook's days and stops to a trip, appended or merged, as one undoable change",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    body: Body,
    response: Application,
    idempotent: {
      onReplay: ({ actor, params, request, status, body }) => {
        const answer = Application.safeParse(body);
        logApply({
          ...unapplied(actor.userId, params["tripId"]!, request as Body),
          outcome: "replayed",
          reason: null,
          status,
          ...(answer.success
            ? {
                playbookId: answer.data.playbookId,
                playbookVersion: answer.data.playbookVersion,
                dayCount: answer.data.dayIds.length,
                createdDayCount: answer.data.createdDayIds.length,
                activityCount: answer.data.activityIds.length,
                warningCount: answer.data.warnings.length,
                historySeq: answer.data.historySeq,
              }
            : {}),
        });
      },
    },
    handle: async ({ actor, params, body, trip }) => {
      const tripId = params["tripId"]!;
      const request = body as Body;
      const logged = unapplied(actor.userId, tripId, request);
      const placement = request.placement ?? { mode: "append" as const };
      const result = await insertSavedDay(request.playbookId, tripId, actor.userId, {
        version: request.version,
        startingAt: placement.mode === "startingAt" ? placement.dayId : undefined,
        expectedSeq: request.expectedTripSeq,
      });
      if (!result.ok) {
        const { error } = result;
        switch (error.code) {
          // Someone else's private Playbook reads as missing, exactly like one
          // that does not exist — `readableSavedDay` decides, and a 403 here
          // would confirm the id.
          case "not-found":
            return reject(logged, "playbook-not-found", new PublicApiError(404, "No such playbook."));
          case "version-mismatch":
            return reject(
              logged,
              "version-mismatch",
              new PublicApiError(409, error.message, "conflict", {
                currentVersion: "currentVersion" in error ? error.currentVersion : undefined,
              }),
            );
          case "unknown-day":
            return reject(logged, "unknown-day", new PublicApiError(400, error.message, "invalid-request"));
          case "concurrency-conflict": {
            // A stale `expectedTripSeq` knows the head it lost to. A race lost
            // at the append itself does not — its transaction is gone — so the
            // head is read once more, only to say where the trip now stands.
            //
            // **Only the race is retryable.** With no `expectedTripSeq` the same
            // body sent again reads the new head and may land, so an
            // `Idempotency-Key` must not keep this 409 (ADR-051). A stale
            // `expectedTripSeq` fails the same way every time, and is kept.
            const currentSeq =
              ("currentSeq" in error ? error.currentSeq : undefined) ?? (await readStreamHeadSeq(db, tripId));
            const raced = request.expectedTripSeq === undefined;
            return reject(
              logged,
              raced ? "concurrency-conflict" : "stale-trip-seq",
              new PublicApiError(409, error.message, "conflict", { currentSeq }, raced ? { retryable: true } : undefined),
            );
          }
        }
        // Every other refusal is the command pipeline's. `refusal` never
        // answers ok, so `orThrow` always throws.
        const outcome = refusal(error);
        if (!outcome.ok) logApply({ ...logged, outcome: "rejected", reason: error.code, status: outcome.status });
        return orThrow(outcome);
      }
      // Newest first, and this batch was the last append.
      const entry = result.history.entries[0];
      if (entry === undefined) throw new Error("an accepted batch left no history entry");
      // `trip` is the gate's read, taken before the batch — the "before" the
      // warnings are measured against.
      const warnings = applicationWarnings(trip!, result.detail, result.minted.activityIds);
      logApply({
        ...logged,
        outcome: "ok",
        reason: null,
        status: 201,
        playbookVersion: result.playbookVersion,
        dayCount: result.minted.dayIds.length,
        createdDayCount: result.minted.createdDayIds.length,
        activityCount: result.minted.activityIds.length,
        warningCount: warnings.length,
        historySeq: entry.toSeq,
      });
      return {
        tripId,
        playbookId: request.playbookId,
        playbookVersion: result.playbookVersion,
        dayIds: result.minted.dayIds,
        createdDayIds: result.minted.createdDayIds,
        activityIds: result.minted.activityIds,
        historySeq: entry.toSeq,
        warnings,
      };
    },
  },
});
