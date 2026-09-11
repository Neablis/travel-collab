// The batch flush — what is left of the planning tool family's adapter.
//
// The derivation moved to the assistant kernel
// (`@/server/assistant/tools/planning`, ADR-043 decision 1): each
// BatchableCommand member still becomes one tool, its input schema still
// transformed by the id-field manifest, and a tool call still records the
// model's raw intent only (ADR-015 Invariant 5). What changed is where the
// COLLECTION lives — it is a declared `needs: ["proposalBuffer"]` dependency
// rather than a closure a builder captured.
//
// **`buildPlanningTools()` is gone (P3), and it is the same shape as F-F02 one
// level down.** Once `WRITE_TOOL_NAMES` was deleted its only remaining caller
// was its own test: production builds a turn's tool set with
// `aiToolsFor(grant.tools, …)` over the registry, so a builder that assembled
// one family by hand was a second way to do the same thing, kept alive by the
// test that asserted it. The claims that test made are real and now sit on the
// definitions themselves (`assistant/tools/planning.test.ts`), which is where
// they cannot be true of a builder and false of the turn.
//
// `flushPlanningBatch` stays here: it is not a tool, it reaches the executor,
// and the kernel does not.
import type { BatchableCommand as BatchableCommandType } from "@tc/contracts";
import { executeTripCommandBatch, type CommandResult } from "../commands";

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
