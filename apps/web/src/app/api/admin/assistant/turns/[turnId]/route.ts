import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { TurnTrace } from "@/lib/askDebug";
import { db } from "@/server/db/client";
import { aiCapabilityGaps, aiTurnOutcomes, aiUsage, aiUsageSteps, aiUsageToolCalls } from "@/server/db/schema";
import { requireAdminApi } from "@/server/entitlements/requireAdmin";
import { microUsdForRow } from "@/server/entitlements/usage";
import { buildTurnTrace } from "@/server/assistant/turnTrace";

// One assistant turn's ledger trace (M57 part 5, ADR-085): its steps, tool
// calls, outcomes and handed-off tasks, for the Ask panel's breakdown row.
//
// **Operators only, so any turn is readable.** The ledger is readable by
// operators and by nobody else (`aiCapabilityGaps`' note), so there is no
// "turns they can see" narrower than the operator gate. An unknown or
// malformed id is the same 404 a non-operator gets, which tells neither
// caller whether the id exists.
//
// **The read is here and the shape is `turnTrace.ts`**: the assistant kernel's
// import wall admits no database, so the kernel builds the timeline from rows
// this route hands it, with the price this route computes.
const TurnId = z.string().guid();

async function loadTurnTrace(turnId: string): Promise<TurnTrace | null> {
  const [turn] = await db.select().from(aiUsage).where(eq(aiUsage.id, turnId));
  if (turn === undefined) return null;
  const [steps, calls, outcomes, gaps] = await Promise.all([
    db.select().from(aiUsageSteps).where(eq(aiUsageSteps.turnId, turnId)),
    db.select().from(aiUsageToolCalls).where(eq(aiUsageToolCalls.turnId, turnId)).orderBy(asc(aiUsageToolCalls.createdAt)),
    db.select().from(aiTurnOutcomes).where(eq(aiTurnOutcomes.turnId, turnId)),
    db.select().from(aiCapabilityGaps).where(eq(aiCapabilityGaps.turnId, turnId)),
  ]);
  return buildTurnTrace({ turn, steps, calls, outcomes, gaps }, (ordered) => {
    // Priced as the console prices a turn: per step at the model it ran on,
    // plus the classifier, at the rate in force when the turn ran.
    const byIndex = new Map(steps.map((step) => [step.stepIndex, step]));
    return microUsdForRow(turn, undefined, undefined, ordered.map((step) => byIndex.get(step.stepIndex)!));
  });
}

/** The trace for the turn `turnId` (an `ai_usage.id`). */
export async function GET(_request: Request, { params }: { params: Promise<{ turnId: string }> }) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const { turnId } = await params;
  const parsed = TurnId.safeParse(turnId);
  const trace = parsed.success ? await loadTurnTrace(parsed.data) : null;
  if (trace === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ trace });
}
