// The read tool family's ADAPTER. The family itself moved to the assistant
// kernel (`@/server/assistant/tools/read`, ADR-043 decision 1) — its four
// definitions, the readout types and the pure functions behind them are all
// there, with the reasoning that goes with each.
//
// What is left here is the re-export surface the rest of `server/ai` still
// reads. **P2 took the tool ASSEMBLY out of it**: `buildReadTools()`,
// `readToolsContext()` and `READ_TOOL_NAMES` are gone, because a turn's tool
// set is now `toolsFor(grant)` over the registry and its context is
// `ambientContextFor` over the same definitions (grants.ts, registry.ts).
// **P3 deletes this file**, when the last `@/server/ai/readTools` import
// follows the definitions into the kernel.
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
