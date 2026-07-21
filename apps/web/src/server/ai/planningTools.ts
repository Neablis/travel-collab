// AI planning tools derived from @tc/contracts command schemas (ADR-015,
// Invariant 5: tool schemas must be DERIVED, never hand-written duplicates).
//
// Each BatchableCommand union member becomes one tool, keyed by its `type`.
// The tool's `parameters` schema is that command's schema with `tripId`
// omitted — the AI never chooses which trip; the server injects it. Calling
// a tool doesn't execute anything by itself: it pushes the fully-formed
// command (type + injected tripId + the AI's args) onto an in-memory,
// closure-scoped pending array shared by every tool built in the same
// `buildPlanningTools` call. `flushPlanningBatch` then submits whatever was
// collected as ONE atomic batch via `executeTripCommandBatch` (ADR-013: one
// batchId, one history entry — same guarantee as the M6 UI batching path).
import { tool, type Tool } from "ai";
import { z } from "zod";
import { BatchableCommand, type BatchableCommand as BatchableCommandType } from "@tc/contracts";
import { executeTripCommandBatch, type CommandResult } from "../commands";

// Short, human-readable descriptions for the model — keyed by command type.
// Not derived from the contract (the contract has no description field);
// kept here as the one place hand-written tool copy lives.
const DESCRIPTIONS: Record<BatchableCommandType["type"], string> = {
  AddDay: "Add a day to the trip.",
  RemoveDay: "Remove a day from the trip; its activities return to the backlog.",
  SetTripStartDate: "Set (or clear, with null) the trip's start date.",
  AddActivity: "Add an activity, optionally placed on a day or left in the backlog.",
  UpdateActivity: "Update fields on an existing activity. Omitted fields are unchanged.",
  MoveActivity: "Move an activity to a different day (or the backlog) and position.",
  RemoveActivity: "Remove an activity from the trip.",
  DismissConflict: "Dismiss a detected scheduling conflict.",
  SetTripCurrency: "Set the trip's currency (ISO 4217 code).",
  SetTripBudget: "Set (or clear, with null) the trip's budget.",
};

export function buildPlanningTools(tripId: string): {
  tools: Record<string, Tool>;
  getCollected: () => BatchableCommandType[];
} {
  const collected: BatchableCommandType[] = [];
  const tools: Record<string, Tool> = {};

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
    const parameters = optionSchema.omit({ tripId: true, type: true }) as unknown as z.ZodTypeAny;

    tools[type] = tool({
      description: DESCRIPTIONS[type],
      parameters,
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
