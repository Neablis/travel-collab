// AI planning tools derived from @tc/contracts command schemas (ADR-015,
// Invariant 5: tool schemas must be DERIVED, never hand-written duplicates).
//
// Each BatchableCommand union member becomes one tool, keyed by its `type`.
// The tool's `inputSchema` is that command's schema with `tripId`
// omitted — the AI never chooses which trip; the server injects it. Calling
// a tool doesn't execute anything by itself: it pushes the fully-formed
// command (type + injected tripId + the AI's args) onto an in-memory,
// closure-scoped pending array shared by every tool built in the same
// `buildPlanningTools` call. `flushPlanningBatch` then submits whatever was
// collected as ONE atomic batch via `executeTripCommandBatch` (ADR-013: one
// batchId, one history entry — same guarantee as the M6 UI batching path).
//
// Reference resolution ("IDs now, resolver later"): LLMs are unreliable at
// copying UUIDs verbatim, so the three activity-targeting tools (Update /
// Move / Remove) don't require the raw UUID. Their id-bearing fields are
// SWAPPED (not the whole schema — Invariant 5) for human `*Ref` fields the
// tool's execute() resolves against `detail` before building the command:
//   - `activityId` -> `activityRef`: an activity's exact title (as inlined in
//     the context envelope) OR its id. A bare id that still exists is a valid
//     ref, so the old "copy the UUID" behaviour keeps working — the title path
//     is a safety net, not a replacement.
//   - MoveActivity's `toDayId` -> `dayRef`: `"day N"` (1-based, matching the
//     UI and planSummary), a bare day number, a dayId, `"backlog"`, or null
//     (both mean the backlog).
// Ambiguity is explicit: a title matching two+ activities does NOT guess — the
// tool returns an error asking the model to use the exact id, and pushes
// nothing. The model sees that error as the tool result and can correct within
// the request's step budget (see handleAiRequest's MAX_STEPS).
import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  BatchableCommand,
  type BatchableCommand as BatchableCommandType,
  type TripDetail,
} from "@tc/contracts";
import { executeTripCommandBatch, type CommandResult } from "../commands";

// Short, human-readable descriptions for the model — keyed by command type.
// Not derived from the contract (the contract has no description field);
// kept here as the one place hand-written tool copy lives.
const DESCRIPTIONS: Record<BatchableCommandType["type"], string> = {
  AddDay: "Add a day to the trip.",
  RemoveDay: "Remove a day from the trip; its activities return to the backlog.",
  SetTripStartDate: "Set (or clear, with null) the trip's start date.",
  AddActivity: "Add an activity, optionally placed on a day or left in the backlog.",
  UpdateActivity:
    "Update fields on an existing activity (name it via activityRef — its title or id). Omitted fields are unchanged.",
  MoveActivity:
    'Move an activity (activityRef: title or id) to a different day (dayRef: "day N", a dayId, or null/backlog) and position.',
  RemoveActivity: "Remove an activity from the trip (name it via activityRef — its title or id).",
  DismissConflict: "Dismiss a detected scheduling conflict.",
  SetTripCurrency: "Set the trip's currency (ISO 4217 code).",
  SetTripBudget: "Set (or clear, with null) the trip's budget.",
};

// The command types whose id-bearing fields are swapped for human `*Ref`
// fields. Every other type keeps its derived schema untouched.
const REF_TOOL_TYPES = new Set<BatchableCommandType["type"]>([
  "UpdateActivity",
  "MoveActivity",
  "RemoveActivity",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const activityRefSchema = z
  .string()
  .min(1)
  .describe("The activity's exact title as shown in the context, or its id.");

const dayRefSchema = z
  .union([z.string(), z.number().int()])
  .nullable()
  .describe('Target day: "day N" (1-based, e.g. "day 2"), a dayId, "backlog", or null for the backlog.');

type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

// Resolver closed over one trip's `detail`. Built once per request; the
// title index makes ambiguity (two activities sharing a title) an O(1) check.
function buildRefResolver(detail: TripDetail) {
  const idsByTitle = new Map<string, string[]>();
  for (const [id, activity] of Object.entries(detail.activities)) {
    const key = activity.title.trim().toLowerCase();
    const existing = idsByTitle.get(key);
    if (existing) existing.push(id);
    else idsByTitle.set(key, [id]);
  }

  function resolveActivity(ref: string): Resolved<string> {
    const trimmed = ref.trim();
    if (UUID_RE.test(trimmed)) {
      if (detail.activities[trimmed]) return { ok: true, value: trimmed };
      return { ok: false, error: `No activity with id ${trimmed} exists on this trip.` };
    }
    const matches = idsByTitle.get(trimmed.toLowerCase()) ?? [];
    if (matches.length === 0) {
      return {
        ok: false,
        error: `No activity named “${ref}”. Reference an activity by its exact title as it appears in the context, or by its id.`,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        error: `“${ref}” matches ${matches.length} activities. Reference the one you mean by its exact id from the context instead of its title.`,
      };
    }
    return { ok: true, value: matches[0]! };
  }

  function resolveDayNumber(n: number, label: string): Resolved<string | null> {
    if (!Number.isInteger(n) || n < 1 || n > detail.days.length) {
      return {
        ok: false,
        error: `Day ${label} is out of range — this trip has ${detail.days.length} day(s), numbered 1..${detail.days.length}.`,
      };
    }
    return { ok: true, value: detail.days[n - 1]!.dayId };
  }

  function resolveDay(ref: string | number | null): Resolved<string | null> {
    if (ref === null) return { ok: true, value: null }; // backlog
    if (typeof ref === "number") return resolveDayNumber(ref, String(ref));

    const trimmed = ref.trim();
    if (trimmed.toLowerCase() === "backlog") return { ok: true, value: null };
    if (UUID_RE.test(trimmed)) {
      const found = detail.days.some((d) => d.dayId === trimmed);
      return found
        ? { ok: true, value: trimmed }
        : { ok: false, error: `No day with id ${trimmed} exists on this trip.` };
    }
    const match = /^(?:day\s*)?(\d+)$/i.exec(trimmed);
    if (!match) {
      return {
        ok: false,
        error: `Couldn't read “${ref}” as a day. Use "day N" (1-based), a dayId, or null for the backlog.`,
      };
    }
    return resolveDayNumber(Number(match[1]), `“${ref}”`);
  }

  return { resolveActivity, resolveDay };
}

export function buildPlanningTools(
  tripId: string,
  detail: TripDetail,
): {
  tools: Record<string, Tool>;
  getCollected: () => BatchableCommandType[];
} {
  const collected: BatchableCommandType[] = [];
  const tools: Record<string, Tool> = {};
  const resolver = buildRefResolver(detail);

  // The union members have incompatible `.omit` overloads (each ZodObject's
  // shape differs), so TS can't call it generically across the union — cast
  // to a common ZodObject shape to iterate; the `type` value read off each
  // member's shape is still narrowed via BatchableCommandType["type"] below.
  for (const optionSchema of BatchableCommand.options as unknown as z.ZodObject<
    { type: z.ZodLiteral<string> } & z.ZodRawShape
  >[]) {
    const type = optionSchema.shape.type.value as BatchableCommandType["type"];
    // omit({ tripId: true, type: true }) drops both from the schema and its
    // required-keys set: tripId is injected server-side (the AI never chooses
    // which trip), and `type` is redundant once the command is identified by
    // its tool name — execute() re-adds both before collecting the command.
    const base = optionSchema.omit({ tripId: true, type: true });

    if (REF_TOOL_TYPES.has(type)) {
      // Swap only the id-bearing fields (Invariant 5: keep the rest of the
      // derived schema intact). activityId -> activityRef for all three;
      // MoveActivity additionally swaps toDayId -> dayRef.
      const withActivityRef = base
        .omit({ activityId: true })
        .extend({ activityRef: activityRefSchema });
      const refSchema =
        type === "MoveActivity"
          ? withActivityRef.omit({ toDayId: true }).extend({ dayRef: dayRefSchema })
          : withActivityRef;

      tools[type] = tool({
        description: DESCRIPTIONS[type],
        inputSchema: refSchema as unknown as z.ZodTypeAny,
        execute: async (args: Record<string, unknown>) => {
          const { activityRef, dayRef, ...rest } = args as {
            activityRef: string;
            dayRef?: string | number | null;
          } & Record<string, unknown>;

          const activity = resolver.resolveActivity(activityRef);
          if (!activity.ok) return { queued: false, error: activity.error };

          const resolved: Record<string, unknown> = { ...rest, activityId: activity.value };
          if (type === "MoveActivity") {
            const day = resolver.resolveDay(dayRef ?? null);
            if (!day.ok) return { queued: false, error: day.error };
            resolved.toDayId = day.value;
          }

          const command = { ...resolved, type, tripId } as BatchableCommandType;
          collected.push(command);
          return { queued: true, type, tripId };
        },
      });
      continue;
    }

    tools[type] = tool({
      description: DESCRIPTIONS[type],
      inputSchema: base as unknown as z.ZodTypeAny,
      execute: async (args: Record<string, unknown>) => {
        const command = { ...args, type, tripId } as BatchableCommandType;
        collected.push(command);
        return { queued: true, type, tripId };
      },
    });
  }

  return { tools, getCollected: () => collected };
}

// Submits the collected commands as ONE atomic batch (ADR-013: one batchId,
// one history entry — either every command in the batch succeeds, or none
// of them are appended).
export async function flushPlanningBatch(
  _tripId: string,
  calls: BatchableCommandType[],
  actorId: string,
): Promise<CommandResult> {
  return executeTripCommandBatch(calls, actorId);
}
