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
import { activeConflicts } from "./context";

// Short, human-readable descriptions for the model — keyed by command type.
// Not derived from the contract (the contract has no description field);
// kept here as the one place hand-written tool copy lives.
// Money is ALWAYS integer minor units (cents), never a decimal — the single
// biggest silent-corruption trap for the model, so every money-bearing tool
// spells it out (an amount of 500 means 5.00, not 500.00).
const MONEY_UNITS_NOTE =
  "Money is integer minor units (cents): amountMinor 500 = 5.00, so multiply a decimal amount by 100 (e.g. 500 EUR → amountMinor 50000).";

const DESCRIPTIONS: Record<BatchableCommandType["type"], string> = {
  AddDay: "Add a day to the trip.",
  RemoveDay: 'Remove an existing day from the trip (dayRef: "day N" or its dayId); its activities return to the backlog.',
  SetTripStartDate: "Set (or clear, with null) the trip's start date.",
  AddActivity: `Add an activity, optionally placed on a day or left in the backlog. ${MONEY_UNITS_NOTE}`,
  UpdateActivity: `Update fields on an existing activity (name it via activityRef — its title or id). Omitted fields are unchanged. ${MONEY_UNITS_NOTE}`,
  MoveActivity:
    'Move an activity (activityRef: title or id) to a different day (dayRef: "day N", a dayId, or null/backlog) and position.',
  RemoveActivity: "Remove an activity from the trip (name it via activityRef — its title or id).",
  DismissConflict:
    "Dismiss an active conflict by its number in the context's `conflicts` list (conflictRef: e.g. 1). Only conflicts shown there can be dismissed.",
  SetTripCurrency: "Set the trip's currency (ISO 4217 code).",
  SetTripBudget: `Set (or clear, with null) the trip's budget. ${MONEY_UNITS_NOTE}`,
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

// RemoveDay targets an *existing* day and has no backlog concept, so its ref is
// non-nullable — unlike dayRefSchema, "backlog"/null is not a valid choice here
// (execute() rejects a ref that resolves to the backlog with a clear error).
const removeDayRefSchema = z
  .union([z.string(), z.number().int()])
  .describe('The day to remove: "day N" (1-based, e.g. "day 2") or its dayId. Must be an existing day — the backlog is not a day and cannot be removed.');

const conflictRefSchema = z
  .union([z.string(), z.number().int()])
  .describe("The conflict to dismiss, by its `ref` number in the context's `conflicts` list (e.g. 1). Never a raw conflict id.");

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

  // Conflict ids are compound, UUID-embedding strings the model never sees; it
  // references an active conflict by the 1-based `ref` shown in the envelope's
  // `conflicts` list (built from the SAME `activeConflicts(detail)`, so the
  // numbering matches). A bare exact id is still accepted as a fallback.
  const conflicts = activeConflicts(detail);
  function resolveConflict(ref: string | number): Resolved<string> {
    if (conflicts.length === 0) {
      return { ok: false, error: "There are no active conflicts to dismiss." };
    }
    const asNum =
      typeof ref === "number" ? ref : /^\d+$/.test(ref.trim()) ? Number(ref.trim()) : null;
    if (asNum !== null) {
      const match = conflicts.find((c) => c.ref === asNum);
      if (!match) {
        return {
          ok: false,
          error: `Conflict ${asNum} is out of range — there ${conflicts.length === 1 ? "is" : "are"} ${conflicts.length} active conflict(s), numbered 1..${conflicts.length}.`,
        };
      }
      return { ok: true, value: match.id };
    }
    const refStr = typeof ref === "string" ? ref.trim() : String(ref);
    const byId = conflicts.find((c) => c.id === refStr);
    if (byId) return { ok: true, value: byId.id };
    return {
      ok: false,
      error: `Couldn't read “${ref}” as a conflict. Reference an active conflict by its number (e.g. 1) from the context's conflicts list.`,
    };
  }

  return { resolveActivity, resolveDay, resolveConflict };
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

  // The single typed choke point between a tool's (resolved) args and the
  // pending batch: model output becomes a domain command only by PARSING
  // against the contract, never by an unchecked `as` cast. A parse failure
  // here means our derived tool schema or a ref resolver has drifted from
  // `BatchableCommand` — surface it as a tool error (same shape a failed ref
  // returns) so the model sees it, rather than pushing a malformed command
  // onto the batch or throwing out of execute(). `.parse` also strips any
  // stray keys, so what we collect is exactly the contract shape.
  // NOTE: this makes the tool layer *locally* type-safe; `executeTripCommandBatch`
  // still re-parses the whole batch as the authoritative boundary. See the
  // "typed AI-gateway wrapper" tech-debt note (KI-9) for the broader follow-up.
  function collect(raw: Record<string, unknown>): { queued: true; type: string; tripId: string } | { queued: false; error: string } {
    const parsed = BatchableCommand.safeParse(raw);
    if (!parsed.success) {
      return { queued: false, error: `Could not build a valid command: ${parsed.error.message}` };
    }
    collected.push(parsed.data);
    return { queued: true, type: parsed.data.type, tripId };
  }

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

    if (type === "AddActivity") {
      // AddActivity's activityId isn't resolved against anything — it's a
      // fresh id for a new entity — but its optional dayId targets an
      // *existing* day, same as MoveActivity's toDayId, so it gets the same
      // dayRef swap and the same "don't require a verbatim UUID" guarantee.
      const refSchema = base.omit({ dayId: true }).extend({ dayRef: dayRefSchema.optional() });

      tools[type] = tool({
        description: DESCRIPTIONS[type],
        inputSchema: refSchema as unknown as z.ZodTypeAny,
        execute: async (args: Record<string, unknown>) => {
          const { dayRef, ...rest } = args as { dayRef?: string | number | null } & Record<string, unknown>;

          const day = resolver.resolveDay(dayRef ?? null);
          if (!day.ok) return { queued: false, error: day.error };

          return collect({
            ...rest,
            ...(day.value !== null ? { dayId: day.value } : {}),
            type,
            tripId,
          });
        },
      });
      continue;
    }

    if (type === "RemoveDay") {
      // Same class as the AddActivity fix: RemoveDay.dayId targets an existing
      // day, so require a human dayRef instead of a verbatim UUID. Unlike
      // AddActivity/MoveActivity, RemoveDay has NO backlog concept, so a ref
      // that resolves to the backlog (null/"backlog") is rejected outright
      // rather than silently building a command with no dayId.
      const refSchema = base.omit({ dayId: true }).extend({ dayRef: removeDayRefSchema });

      tools[type] = tool({
        description: DESCRIPTIONS[type],
        inputSchema: refSchema as unknown as z.ZodTypeAny,
        execute: async (args: Record<string, unknown>) => {
          const { dayRef, ...rest } = args as { dayRef: string | number } & Record<string, unknown>;

          const day = resolver.resolveDay(dayRef ?? null);
          if (!day.ok) return { queued: false, error: day.error };
          if (day.value === null) {
            return {
              queued: false,
              error:
                'RemoveDay needs an existing day — reference it as "day N" (1-based) or its dayId. The backlog is not a day and cannot be removed.',
            };
          }

          return collect({ ...rest, dayId: day.value, type, tripId });
        },
      });
      continue;
    }

    if (type === "DismissConflict") {
      // Same id-verbatim class: the real conflictId is a compound UUID-embedding
      // string the model is never shown. Swap it for conflictRef (the 1-based
      // number from the envelope's `conflicts` list), resolved server-side.
      const refSchema = base.omit({ conflictId: true }).extend({ conflictRef: conflictRefSchema });

      tools[type] = tool({
        description: DESCRIPTIONS[type],
        inputSchema: refSchema as unknown as z.ZodTypeAny,
        execute: async (args: Record<string, unknown>) => {
          const { conflictRef, ...rest } = args as { conflictRef: string | number } & Record<string, unknown>;

          const conflict = resolver.resolveConflict(conflictRef);
          if (!conflict.ok) return { queued: false, error: conflict.error };

          return collect({ ...rest, conflictId: conflict.value, type, tripId });
        },
      });
      continue;
    }

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

          return collect({ ...resolved, type, tripId });
        },
      });
      continue;
    }

    tools[type] = tool({
      description: DESCRIPTIONS[type],
      inputSchema: base as unknown as z.ZodTypeAny,
      execute: async (args: Record<string, unknown>) => {
        return collect({ ...args, type, tripId });
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
