// AI planning tools derived from @tc/contracts command schemas (ADR-015,
// Invariant 5: tool schemas must be DERIVED, never hand-written duplicates).
//
// Each BatchableCommand member becomes one `defineTool` call. Its input schema
// is that command's schema TRANSFORMED by the id-field manifest (idFields.ts)
// so the AI never handles a UUID: `type` is dropped (implied by the tool name);
// `inject` fields (tripId) are dropped (server-injected); `mint` fields (new
// ids) are dropped (server-generated); `ref` fields (an EXISTING
// day/activity/conflict) are swapped for a human `<entity>Ref`. A tool call
// records the model's raw intent only — resolveBatch (batchResolver.ts) turns
// the ordered batch into concrete commands in one batch-aware pass, then
// flushPlanningBatch submits them as ONE atomic batch (ADR-013).
//
// `defineTool` is the envelope and this loop is the body: a thirteenth
// BatchableCommand becomes a thirteenth tool with no hand edit here, and
// therefore a thirteenth entry in the registry — and, since P2, a thirteenth
// member of every grant that reaches `itinerary`/`propose`. There is no list of
// command names in this file and there must never be one.
//
// The loop is a pass-through, deliberately: wrapping these definitions in
// anything that alters a schema or a `run` would be the reimplementation
// ADR-022 §4 rules out.
import { z } from "zod";
import { BatchableCommand, type BatchableCommand as BatchableCommandType } from "@tc/contracts";
import { ID_FIELDS, refParamName, type IdRole } from "@/server/ai/idFields";
import { defineTool, type AnyAssistantTool } from "@/server/assistant/defineTool";

const MONEY_UNITS_NOTE =
  "Money is integer minor units (cents): amountMinor 500 = 5.00, so multiply a decimal amount by 100 (e.g. 500 EUR → amountMinor 50000).";

const DESCRIPTIONS: Record<BatchableCommandType["type"], string> = {
  AddDay: "Add a new day to the trip (the server assigns its id).",
  RemoveDay: 'Remove an existing day (dayRef: "day N" or its dayId); its activities return to the backlog.',
  SetTripStartDate: "Set (or clear, with null) the trip's start date.",
  SetTripName: "Rename the trip.",
  SetTripDates: "Set the trip's date range; the server reconciles day count to match it.",
  AddActivity: `Add a new activity; place it on a day via dayRef ("day N") or leave it in the backlog. ${MONEY_UNITS_NOTE}`,
  UpdateActivity: `Update fields on an existing activity (activityRef — its title or id). Omitted fields are unchanged. ${MONEY_UNITS_NOTE}`,
  MoveActivity:
    'Move an activity (activityRef) to a different day (dayRef: "day N", a dayId, or null/backlog) and position.',
  RemoveActivity: "Remove an activity from the trip (activityRef — its title or id).",
  DismissConflict:
    "Dismiss an active conflict by its number in the context's `conflicts` list (conflictRef: e.g. 1). Only conflicts shown there can be dismissed.",
  SetTripCurrency: "Set the trip's currency (ISO 4217 code).",
  SetTripBudget: `Set (or clear, with null) the trip's budget. ${MONEY_UNITS_NOTE}`,
};

const activityRefSchema = z
  .string()
  .min(1)
  .describe("An existing activity's exact title (as shown in the context) or its id.");

const conflictRefSchema = z
  .union([z.string(), z.number().int()])
  .describe("The conflict to dismiss, by its `ref` number in the context's `conflicts` list (e.g. 1). Never a raw conflict id.");

/**
 * What a `ref` day field is swapped for: a day as a person names one — "day 2",
 * a dayId, or the backlog.
 */
function dayRefSchema(backlog: "null" | "omit" | undefined): z.ZodTypeAny {
  const base = z
    .union([z.string(), z.number().int()])
    .nullable()
    .describe('A day as "day N" (1-based, e.g. "day 2"), a dayId, or "backlog"/null for the backlog.');
  // `omit` backlog fields are truly optional (a bare add = backlog); `null`
  // backlog fields must be stated (choose a day or the backlog).
  return backlog === "omit" ? base.optional() : base;
}

/**
 * The `ref` half of the id-field manifest: one field naming an EXISTING entity,
 * as the human reference the model is asked for in place of its id.
 */
function refSchemaFor(role: Extract<IdRole, { role: "ref" }>): z.ZodTypeAny {
  switch (role.entity) {
    case "activity":
      return activityRefSchema;
    case "day":
      return dayRefSchema(role.backlog);
    case "conflict":
      return conflictRefSchema;
  }
}

// Every write tool answers the same receipt, so the shape is stated once. It
// is a `literal(true)`, not a boolean: "queued" is the only thing a collect-only
// tool can truthfully say, and a schema that could also carry `false` would be
// a schema that admits a tool having done something.
const QueuedReceipt = z.object({ queued: z.literal(true), type: z.string() });

/**
 * One `BatchableCommand` member as one tool — the derivation ADR-015
 * invariant 5 requires, performed per command.
 *
 * The contract's own schema, with `type` and the server-supplied ids dropped
 * and each `ref` field swapped for a human reference, and a `run` that records
 * the model's raw intent in the turn's buffer. Nothing here names a command,
 * which is what makes the thirteenth one free.
 */
function planningToolFor(optionSchema: z.ZodObject<{ type: z.ZodLiteral<string> } & z.ZodRawShape>): AnyAssistantTool {
  const type = optionSchema.shape.type.value as BatchableCommandType["type"];

  let schema = optionSchema.omit({ type: true, tripId: true }) as unknown as z.ZodObject<z.ZodRawShape>;
  for (const [field, role] of Object.entries(ID_FIELDS[type]) as [string, IdRole][]) {
    const drop = { [field]: true } as Record<string, true>;
    if (role.role === "mint") {
      schema = schema.omit(drop) as unknown as z.ZodObject<z.ZodRawShape>;
    } else if (role.role === "ref") {
      schema = schema
        .omit(drop)
        .extend({ [refParamName(role.entity)]: refSchemaFor(role) }) as unknown as z.ZodObject<z.ZodRawShape>;
    }
  }

  return defineTool({
    name: type,
    description: DESCRIPTIONS[type],
    domain: "itinerary",
    // Collect-only, and that is what `propose` means: the intent is recorded
    // and the loop ends. Nothing in the agent loop has a reachable path to an
    // event.
    effect: "propose",
    spend: "none",
    input: schema,
    output: QueuedReceipt,
    needs: ["proposalBuffer"] as const,
    minimumRole: "editor",
    run: (args: Record<string, unknown>, deps) => {
      deps.proposalBuffer.collect({ type, args });
      return { queued: true as const, type };
    },
  }) as unknown as AnyAssistantTool;
}

/**
 * One tool per `BatchableCommand` union member, keyed by type — MEASURED from
 * the contract rather than listed, which is what makes a thirteenth command a
 * thirteenth tool for free.
 *
 * Built once at module load rather than per turn. That is the second thing the
 * collector-as-dependency rule bought: with the collection injected, a
 * definition holds no per-turn state, so it is a constant.
 */
export const PLANNING_TOOLS: readonly AnyAssistantTool[] = (
  BatchableCommand.options as unknown as z.ZodObject<{ type: z.ZodLiteral<string> } & z.ZodRawShape>[]
).map(planningToolFor);
