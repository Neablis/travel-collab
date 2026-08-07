// AI planning tools derived from @tc/contracts command schemas (ADR-015,
// Invariant 5: tool schemas must be DERIVED, never hand-written duplicates).
//
// Each BatchableCommand member becomes one tool. Its inputSchema is that
// command's schema TRANSFORMED by the id-field manifest (idFields.ts) so the AI
// never handles a UUID: `type` is dropped (implied by the tool name); `inject`
// fields (tripId) are dropped (server-injected); `mint` fields (new ids) are
// dropped (server-generated); `ref` fields (an EXISTING day/activity/conflict)
// are swapped for a human `<entity>Ref`. A tool call records the model's raw
// intent only — resolveBatch (batchResolver.ts) turns the ordered batch into
// concrete commands in one batch-aware pass, then flushPlanningBatch submits
// them as ONE atomic batch (ADR-013).
import { tool, type Tool } from "ai";
import { z } from "zod";
import { BatchableCommand, type BatchableCommand as BatchableCommandType } from "@tc/contracts";
import { executeTripCommandBatch, type CommandResult } from "../commands";
import { ID_FIELDS, refParamName, type IdRole } from "./idFields";
import type { RawToolIntent } from "./batchResolver";

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

function dayRefSchema(backlog: "null" | "omit" | undefined): z.ZodTypeAny {
  const base = z
    .union([z.string(), z.number().int()])
    .nullable()
    .describe('A day as "day N" (1-based, e.g. "day 2"), a dayId, or "backlog"/null for the backlog.');
  // `omit` backlog fields are truly optional (a bare add = backlog); `null`
  // backlog fields must be stated (choose a day or the backlog).
  return backlog === "omit" ? base.optional() : base;
}

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

export function buildPlanningTools(): {
  tools: Record<string, Tool>;
  getCollected: () => RawToolIntent[];
} {
  const collected: RawToolIntent[] = [];
  const tools: Record<string, Tool> = {};

  for (const optionSchema of BatchableCommand.options as unknown as z.ZodObject<
    { type: z.ZodLiteral<string> } & z.ZodRawShape
  >[]) {
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

    tools[type] = tool({
      description: DESCRIPTIONS[type],
      inputSchema: schema as unknown as z.ZodTypeAny,
      execute: async (args: Record<string, unknown>) => {
        collected.push({ type, args });
        return { queued: true, type };
      },
    });
  }

  return { tools, getCollected: () => collected };
}

// Submits the resolved commands as ONE atomic batch (ADR-013).
export async function flushPlanningBatch(
  _tripId: string,
  calls: BatchableCommandType[],
  actorId: string,
): Promise<CommandResult> {
  return executeTripCommandBatch(calls, actorId);
}
