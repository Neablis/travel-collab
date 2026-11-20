import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { mfaAttempts } from "@/server/db/schema";

// D13: five wrong codes inside fifteen minutes lock codes for the account for
// fifteen minutes. Passkeys are not limited: a signature
// cannot be guessed.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** One wrong code, for this account. `now` is injected. */
export async function recordFailure(userId: string, now: Date): Promise<void> {
  await db.insert(mfaAttempts).values({ id: randomUUID(), userId, at: now });
}

/**
 * Whether codes are refused for this account right now: its latest five failures
 * all fall inside one 15-minute window, and the newest is under 15 minutes old.
 * Derived from the rows, never stored, so the lock lifts by itself and there is
 * nothing to sweep or forget to clear. Callers do not record failures while it
 * holds, so the lock does not extend itself.
 */
export async function isLocked(userId: string, now: Date): Promise<boolean> {
  const latest = await db
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
