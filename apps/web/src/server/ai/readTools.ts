// The read tool family's ADAPTER. The family itself moved to the assistant
// kernel (`@/server/assistant/tools/read`, ADR-043 decision 1) — its four
// definitions, the readout types and the pure functions behind them are all
// there, with the reasoning that goes with each.
//
// What is left here is the shape `handleAskRequest` still calls, re-exported so
// nothing outside the kernel had to move in the same change. **P2 and P3 delete
// this file**: `buildReadTools()` becomes `toolsFor(grant)` over the registry,
// and `readToolsContext` becomes the `AssistantDeps` the admission pipeline
// builds.
import type { z } from "zod";
import {
  FindFreeTimeInputSchema,
  ReadDayInput,
  ReadTripInput,
  SearchPlaybooksInputSchema,
  findFreeTimeTool,
  readDayTool,
  readTripTool,
  searchPlaybooksTool,
} from "@/server/assistant/tools/read";
import { AssistantContextSchema, type AssistantContext } from "@/server/assistant/deps";
import { contextTool } from "@/server/assistant/registry";

export {
  MAX_PLAYBOOK_RESULTS,
  MAX_READ_DAYS,
  MAX_SEARCH_CITIES,
  ReadDayInput,
  FindFreeTimeInputSchema,
  SearchPlaybooksInputSchema,
  findFreeTime,
  readDay,
  readDays,
  readTrip,
  searchPlaybooks,
} from "@/server/assistant/tools/read";
export type {
  DayBatchReadout,
  DayReadout,
  FindFreeTimeInput,
  FreeTimeGapReadout,
  FreeTimeReadout,
  PlaybookDayReadout,
  PlaybookSearchReadout,
  ReadToolProblem,
  SearchPlaybooksInput,
  StopReadout,
  TripDayReadout,
  TripReadout,
} from "@/server/assistant/tools/read";

export const READ_TOOL_NAMES = ["read_trip", "read_day", "find_free_time", "search_playbooks"] as const;
export type ReadToolName = (typeof READ_TOOL_NAMES)[number];

/**
 * What every read tool receives through `toolsContext`, and the only way trip
 * or actor identity reaches one.
 *
 * Now `AssistantContext` (assistant/deps.ts), where it is unpacked into the
 * `trip`, `actor` and `scope` deps a definition names in its `needs` — so the
 * subset each tool actually reads is legible from the tool rather than implied
 * by one ambient bag handed to all of them.
 */
export type ReadToolContext = AssistantContext;

// Exported so `insert_playbook_day` (writeTools.ts) can take the SAME context
// shape rather than a second one: it is the same actor reading the same
// library, and two context schemas would be two places for "who is asking" to
// come from.
export const ReadContextSchema = AssistantContextSchema;

export const READ_TOOL_INPUT_SCHEMAS: Record<ReadToolName, z.ZodObject<z.ZodRawShape>> = {
  read_trip: ReadTripInput,
  read_day: ReadDayInput,
  find_free_time: FindFreeTimeInputSchema,
  search_playbooks: SearchPlaybooksInputSchema,
};

/**
 * The four tools, wired to the four definitions.
 *
 * Argument-free like `buildPageTools()`: everything per-request arrives
 * through `toolsContext`, so the tool set itself is a constant and a test can
 * inspect its schemas without constructing a trip.
 *
 * Written out rather than mapped over `READ_TOOLS` on purpose: the object
 * literal is what gives the returned set its precise per-tool type, which is
 * what `InferToolSetContext` reads to type `toolsContext` at the call site.
 * See `contextTool`'s comment for what an annotated `Record<ReadToolName,
 * Tool>` silently deletes.
 */
export function buildReadTools() {
  return {
    tools: {
      read_trip: contextTool(readTripTool),
      read_day: contextTool(readDayTool),
      find_free_time: contextTool(findFreeTimeTool),
      search_playbooks: contextTool(searchPlaybooksTool),
    },
  };
}

/**
 * The same context under every tool's name — `toolsContext` is keyed by tool.
 * Three of these read the same trip as the same actor; `search_playbooks` reads
 * the library as that same actor, which is the only field it takes from here.
 */
export function readToolsContext(context: ReadToolContext): Record<ReadToolName, ReadToolContext> {
  return { read_trip: context, read_day: context, find_free_time: context, search_playbooks: context };
}
