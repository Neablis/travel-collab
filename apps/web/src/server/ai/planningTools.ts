// The planning tool family's ADAPTER, plus the batch flush.
//
// The derivation itself moved to the assistant kernel
// (`@/server/assistant/tools/planning`, ADR-043 decision 1): each
// BatchableCommand member still becomes one tool, its input schema still
// transformed by the id-field manifest, and a tool call still records the
// model's raw intent only (ADR-015 Invariant 5). What changed is where the
// COLLECTION lives — it is a declared `needs: ["proposalBuffer"]` dependency
// rather than a closure this builder captured, so the definitions are constants
// and this function only mints the buffer for one turn.
//
// `flushPlanningBatch` stays here: it is not a tool, it reaches the executor,
// and the kernel does not.
import type { Tool } from "ai";
import type { BatchableCommand as BatchableCommandType } from "@tc/contracts";
import { executeTripCommandBatch, type CommandResult } from "../commands";
import { newProposalBuffer } from "@/server/assistant/deps";
import { aiToolsFor } from "@/server/assistant/registry";
import { PLANNING_TOOLS } from "@/server/assistant/tools/planning";
import type { RawToolIntent } from "./batchResolver";

export function buildPlanningTools(): {
  tools: Record<string, Tool>;
  getCollected: () => RawToolIntent[];
} {
  const buffer = newProposalBuffer();
  return { tools: aiToolsFor(PLANNING_TOOLS, { proposalBuffer: buffer }), getCollected: () => buffer.collected() };
}

// Submits the resolved commands as ONE atomic batch (ADR-013).
//
// `alsoInSameTransaction` is `executeTripCommandBatch`'s existing seam, carried
// through rather than reimplemented: an approved playbook insert has to write
// its adds-ledger row as part of the same fact as the batch (ADR-042 Decision
// 1, M11b link 4). Reaching the executor a second way instead would be a second
// history entry and a second undo for one approval.
export async function flushPlanningBatch(
  _tripId: string,
  calls: BatchableCommandType[],
  actorId: string,
  alsoInSameTransaction?: Parameters<typeof executeTripCommandBatch>[2],
): Promise<CommandResult> {
  return executeTripCommandBatch(calls, actorId, alsoInSameTransaction);
}
