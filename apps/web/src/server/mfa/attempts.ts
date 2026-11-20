import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { mfaAttempts } from "@/server/db/schema";

// D13: five wrong codes inside fifteen minutes lock codes for the account for
// fifteen minutes. Passkeys are not limited: a signature
// cannot be guessed.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

type Executor = Pick<typeof db, "select" | "insert">;

async function lockedAt(executor: Executor, userId: string, now: Date): Promise<boolean> {
  const latest = await executor
    .select({ at: mfaAttempts.at })
    .from(mfaAttempts)
    .where(eq(mfaAttempts.userId, userId))
    .orderBy(desc(mfaAttempts.at))
    .limit(MAX_FAILURES);
  if (latest.length < MAX_FAILURES) return false;
  const newest = latest[0]!.at.getTime();
  const oldest = latest[MAX_FAILURES - 1]!.at.getTime();
  return newest - oldest <= WINDOW_MS && now.getTime() - newest < WINDOW_MS;
}

/**
 * Whether codes are refused for this account right now: its latest five attempts
 * all fall inside one 15-minute window, and the newest is under 15 minutes old.
 * Derived from the rows, never stored, so the lock lifts by itself and there is
 * nothing to sweep or forget to clear. For display; a check that gates a guess
 * must go through `attemptCode`, which cannot be raced.
 */
export function isLocked(userId: string, now: Date): Promise<boolean> {
  return lockedAt(db, userId, now);
}

export type CodeAttempt = "locked" | "ok" | "wrong";

/**
 * The only way to test a code. The check and the record are one step per account:
 * a transaction under an advisory lock checks the lock and, if it is open, writes
 * the attempt down *before* `verify` runs. A burst of parallel guesses therefore
 * queues here and the sixth finds five rows, instead of all of them reading "not
 * locked" before any failure exists. A correct code deletes its own row, so only
 * wrong ones count; if `verify` throws the row stays, which fails closed.
 *
 * The lock is held for the two statements only, never across `verify`, so a
 * verify that needs the database cannot starve the pool.
 */
export async function attemptCode(userId: string, now: Date, verify: () => Promise<boolean>): Promise<CodeAttempt> {
  const id = randomUUID();
  const admitted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mfa-attempts:${userId}`}))`);
    if (await lockedAt(tx, userId, now)) return false;
    await tx.insert(mfaAttempts).values({ id, userId, at: now });
    return true;
  });
  if (!admitted) return "locked";
  if (!(await verify())) return "wrong";
  await db.delete(mfaAttempts).where(eq(mfaAttempts.id, id));
  return "ok";
}
