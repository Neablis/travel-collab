import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SavedDay, SavedDayVisibility, SavedStop } from "@tc/contracts";
import {
  captureDays,
  readableSavedDay,
  storeSavedDay,
  updatePlaybookContent,
  withoutDateAnchors,
  type RemovedDateAnchor,
} from "@/server/savedDays";
import type { Actor } from "./actor";
import { PublicApiError } from "./commands";
import { sourceTrip } from "./library";
import type { HandlerContext, ResourceDef } from "./route";

// **What `/v1/playbooks` does that `/v1/library` does not** (ADR-050, Pass A):
// compose a Playbook from part of a trip or from the request body, edit its
// content under a version precondition, and read somebody else's published one.
// The declarations the two trees still share are in `library.ts`.

/**
 * At most this many stops in one Playbook written over `v1`. The day bound is
 * `CreateSavedDayInput`'s 366; this is the stop bound beside it, so an inline
 * body cannot be a 366-day, 50,000-stop document. The app's keep has no such
 * limit, and a trip-sourced keep here is held to it after the trip is read.
 */
export const MAX_PLAYBOOK_STOPS = 500;

/** 1..366 — the bound `CreateSavedDayInput.dayIds` already chose, and why is written there. */
const MAX_DAYS = 366;

/**
 * **One stop written inline: a `SavedStop` without its `dayIndex`.** The index
 * is the position of the day it is written in, so a caller cannot send one
 * that disagrees with where they put it. Derived from the contract rather than
 * copied, so a field `SavedStop` gains is a field this accepts.
 */
const StopInput = SavedStop.omit({ dayIndex: true });

/** The days of an inline Playbook, in order. A day with no stops is a rest day. */
const InlineDays = z
  .array(z.object({ stops: z.array(StopInput) }))
  .min(1)
  .max(MAX_DAYS)
  .superRefine((days, ctx) => {
    const total = days.reduce((n, d) => n + d.stops.length, 0);
    if (total === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A Playbook needs at least one stop." });
    }
    if (total > MAX_PLAYBOOK_STOPS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A Playbook may hold at most ${MAX_PLAYBOOK_STOPS} stops; these days hold ${total}.`,
      });
    }
  });

const Name = SavedDay.shape.name;
/** Optional on the way in, where the DTO's default would invent a value nobody sent. */
const Summary = SavedDay.shape.summary.removeDefault();

const FromTrip = z
  .object({
    name: Name,
    summary: Summary.optional(),
    source: z.object({
      tripId: z.string().uuid(),
      days: z
        .array(
          z.object({
            dayId: z.string().uuid(),
            activityIds: z
              .array(z.string().uuid())
              .optional()
              .describe(
                "Keep only these activities of the day, in the trip's order (not this list's). Omitted = the whole day; [] = keep the day, empty.",
              ),
          }),
        )
        .min(1)
        .max(MAX_DAYS)
        .describe("The days to keep, in the order the Playbook will run them."),
    }),
  })
  .strict();

const Inline = z
  .object({
    name: Name,
    summary: Summary.optional(),
    sourceName: SavedDay.shape.sourceTripName
      .optional()
      .describe("Credited as the Playbook's source. Defaults to `name`."),
    days: InlineDays,
  })
  .strict();

/**
 * **Exactly one of two bodies.** Both objects are strict, so a body carrying
 * `source` AND `days` matches neither and is a 400 — the union is exclusive in
 * behaviour. The generator (`zod-to-json-schema`, openApi3 target) renders
 * every union as `anyOf`, and says so in the description rather than claiming a
 * `oneOf` it did not emit.
 */
export const CreatePlaybookBody = z
  .union([FromTrip, Inline])
  .describe(
    "Exactly one of: `{ name, summary?, source: { tripId, days } }` to keep days (or some of their activities) of a trip you can see, or `{ name, summary?, sourceName?, days: [{ stops }] }` to write one inline. Unknown fields are refused, so a body matching both shapes matches neither.",
  );
type CreatePlaybookBody = z.infer<typeof CreatePlaybookBody>;

const PlaybookWarning = z.object({
  code: z.literal("date-anchor-removed"),
  /** The stop's index in `playbook.stops`. */
  stopIndex: z.number().int().nonnegative(),
  title: z.string(),
  message: z.string(),
});

/** What a create or an edit answers: the Playbook as stored, and what was changed on the way in. */
export const PlaybookWritten = z.object({ playbook: SavedDay, warnings: z.array(PlaybookWarning) });
type PlaybookWritten = z.infer<typeof PlaybookWritten>;

export const PatchPlaybookBody = z
  .object({
    name: Name.optional(),
    summary: Summary.optional().describe("null clears it."),
    visibility: SavedDayVisibility.optional(),
    days: InlineDays.optional().describe(
      "Replaces every day and stop. Only while the Playbook is private.",
    ),
    expectedVersion: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The `version` you read. Required to change `name`, `summary` or `days`."),
  })
  .strict()
  .superRefine((body, ctx) => {
    const content = body.name !== undefined || body.summary !== undefined || body.days !== undefined;
    if (!content && body.visibility === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Send at least one of name, summary, visibility or days.",
      });
    }
    if (content && body.expectedVersion === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedVersion"],
        message: "Changing name, summary or days needs the expectedVersion you read.",
      });
    }
  });
type PatchPlaybookBody = z.infer<typeof PatchPlaybookBody>;

/** Inline days → one indexed sequence. A day's position is its `dayIndex`; an empty day leaves a gap (ADR-048). */
function inlineStops(days: z.infer<typeof InlineDays>): SavedStop[] {
  return days.flatMap((day, dayIndex) => day.stops.map((stop) => ({ ...stop, dayIndex })));
}

function warningsFor(removed: readonly RemovedDateAnchor[]): PlaybookWritten["warnings"] {
  return removed.map((r) => ({
    code: "date-anchor-removed" as const,
    stopIndex: r.stopIndex,
    title: r.title,
    message: `"${r.title}" was anchored to ${r.from} to ${r.to}. A Playbook has no dates, so that anchor was removed; its other anchors were kept.`,
  }));
}

/**
 * Keep part of a trip, or write a Playbook inline — either way one new
 * `saved_days` row, private, version 1.
 *
 * **An inline Playbook has no source trip, and the row needs one.**
 * `source_trip_id` is NOT NULL and has never been a foreign key: it is a
 * snapshot of where a Playbook came from (ADR-028/029), and the content
 * importer already stores a declared id that names no row
 * (`packages/fixtures/src/bundle/toPlaybooks.ts`). An inline Playbook gets a
 * freshly minted id there, so two inline Playbooks never claim a common
 * source, and `sourceTripName` is the caller's `sourceName`, or the Playbook's
 * own name when they gave none.
 */
async function createPlaybook(actor: Actor, body: CreatePlaybookBody): Promise<PlaybookWritten> {
  let stops: SavedStop[];
  let source: { dayCount: number; tripId: string; tripName: string };
  if ("source" in body) {
    const detail = await sourceTrip(actor, body.source.tripId);
    const dayIds = body.source.days.map((d) => d.dayId);
    const keepOnly = new Map(
      body.source.days.flatMap((d) => (d.activityIds === undefined ? [] : [[d.dayId, d.activityIds] as const])),
    );
    const captured = captureDays(detail, dayIds, keepOnly);
    if (!captured.ok) throw new PublicApiError(400, captured.error.message);
    stops = captured.value;
    source = { dayCount: dayIds.length, tripId: detail.tripId, tripName: detail.name };
    // Only knowable after the trip is read; an inline body is refused by its schema.
    if (stops.length > MAX_PLAYBOOK_STOPS) {
      throw new PublicApiError(
        400,
        `A Playbook may hold at most ${MAX_PLAYBOOK_STOPS} stops; those days hold ${stops.length}.`,
      );
    }
  } else {
    stops = inlineStops(body.days);
    source = { dayCount: body.days.length, tripId: randomUUID(), tripName: body.sourceName ?? body.name.trim() };
  }

  const stripped = withoutDateAnchors(stops);
  const saved = await storeSavedDay({
    ownerId: actor.userId,
    name: body.name,
    summary: body.summary === undefined || body.summary === null || body.summary.trim() === "" ? null : body.summary.trim(),
    stops: stripped.stops,
    dayCount: source.dayCount,
    sourceTripId: source.tripId,
    sourceTripName: source.tripName,
    now: new Date().toISOString(),
    context: { route: "POST /v1/playbooks", tripId: "source" in body ? source.tripId : null },
  });
  if (!saved.ok) throw new PublicApiError(400, saved.error.message);
  return { playbook: saved.value, warnings: warningsFor(stripped.removed) };
}

export const createPlaybookDef: ResourceDef = {
  summary: "Create a Playbook — from days (or some activities) of a trip you can see, or written inline",
  scope: "library:write",
  body: CreatePlaybookBody,
  response: PlaybookWritten,
  handle: ({ actor, body }) => createPlaybook(actor, body as CreatePlaybookBody),
};

const playbookId = ({ params }: HandlerContext) => params["playbookId"]!;
const MISSING = "No such playbook.";

/**
 * **Yours, or anybody's published one** — `readableSavedDay`, the read rule the
 * public library and the apply already rest on. Somebody else's private
 * Playbook is the same 404 as one that does not exist.
 */
export const getPlaybookDef: ResourceDef = {
  summary: "Get a Playbook — yours, or anyone's published one — every day and stop in order",
  scope: "library:read",
  response: SavedDay,
  handle: async (ctx) => {
    const day = await readableSavedDay(playbookId(ctx), ctx.actor.userId);
    if (day === null) throw new PublicApiError(404, MISSING);
    return day;
  },
};

export const patchPlaybookDef: ResourceDef = {
  summary: "Edit one of your Playbooks — rename it, summarise it, replace its days, or publish it",
  scope: "library:write",
  body: PatchPlaybookBody,
  response: PlaybookWritten,
  handle: async (ctx) => {
    const body = ctx.body as PatchPlaybookBody;
    let days: { stops: SavedStop[]; dayCount: number } | undefined;
    let removed: RemovedDateAnchor[] = [];
    if (body.days !== undefined) {
      const stripped = withoutDateAnchors(inlineStops(body.days));
      days = { stops: stripped.stops, dayCount: body.days.length };
      removed = stripped.removed;
    }
    const outcome = await updatePlaybookContent(playbookId(ctx), ctx.actor.userId, {
      name: body.name,
      summary: body.summary,
      days,
      visibility: body.visibility,
      expectedVersion: body.expectedVersion,
    });
    if (outcome.ok) return { playbook: outcome.value, warnings: warningsFor(removed) };
    switch (outcome.reason) {
      case "not-found":
        throw new PublicApiError(404, "No such playbook of yours.");
      case "invalid":
        throw new PublicApiError(400, outcome.message);
      case "stale":
        throw new PublicApiError(
          409,
          `This playbook is at version ${outcome.currentVersion}. Read it again and resend your change.`,
          "conflict",
          { currentVersion: outcome.currentVersion },
        );
      case "published":
        // Reviews rate the published content, so its days do not change under them.
        throw new PublicApiError(409, "This playbook is published. Unpublish it before editing its days.", "conflict");
    }
  },
};
