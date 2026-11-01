import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { TurnOutcomeKind } from "@/lib/turnOutcomeKinds";
import { db } from "./db/client";
import { aiTurnOutcomes, aiUsage } from "./db/schema";

/**
 * Record what `actor` did with turn `turnId`'s answer. Answers whether a row
 * was written; never throws, because a lost outcome must not cost anyone the
 * action it describes (an approval, an accept).
 *
 * **Only the turn's own asker, for every kind but a suggestion's accept.** The
 * turn id comes from a browser, so the row is written only when `ai_usage`
 * says that turn was this actor's: otherwise anyone could pad another
 * account's turns with outcomes. `anyAsker` is the one exception, because
 * the member who may accept a suggestion is the turn's asker (`requestedBy`)
 * or, on a trip with none, any editor — so `anyAsker` joins on the turn alone.
 */
export async function recordTurnOutcome(
  turnId: string,
  kind: TurnOutcomeKind,
  actor: string,
  { anyAsker = false, now = new Date() }: { anyAsker?: boolean; now?: Date } = {},
): Promise<boolean> {
  try {
    const [turn] = await db
      .select({ id: aiUsage.id })
      .from(aiUsage)
      .where(anyAsker ? eq(aiUsage.id, turnId) : and(eq(aiUsage.id, turnId), eq(aiUsage.userId, actor)))
      .limit(1);
    if (turn === undefined) return false;
    await db.insert(aiTurnOutcomes).values({ id: randomUUID(), turnId, kind, at: now, actor });
    return true;
  } catch (error) {
    console.error("ai: recording a turn outcome failed", { turnId, kind, error });
    return false;
  }
}
