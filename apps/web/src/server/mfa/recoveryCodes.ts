import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { userRecoveryCodes } from "@/server/db/schema";
import { keyedDigest, keyedDigestCandidates } from "@/server/secrets/keyedDigest";

const CODE_COUNT = 10;
// Crockford-style: no 0/O/1/I/L, so a code read off paper cannot be misread.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

// Ten characters from a 31-letter alphabet is about 49 bits: out of reach of the
// 5-in-15 limiter (`attempts.ts`) and of an offline guess against a keyed digest.
function newCode(): string {
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

// What a person types: case, spaces and the dash are not part of the secret.
const normalise = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Ten new codes, shown to the person once; the old set is voided in the same
 * transaction, spent codes included. Only digests are stored.
 */
export async function issueRecoveryCodes(userId: string, now: Date): Promise<string[]> {
  const codes = Array.from({ length: CODE_COUNT }, newCode);
  await db.transaction(async (tx) => {
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
    await tx.insert(userRecoveryCodes).values(
      codes.map((code) => {
        const { digest, keyVersion } = keyedDigest(normalise(code));
        return { id: randomUUID(), userId, codeHash: digest, keyVersion, createdAt: now };
      }),
    );
  });
  return codes;
}

/** True once per code: the spend is one conditional UPDATE, so two racing requests cannot both win. */
export async function consumeRecoveryCode(userId: string, code: string, now: Date): Promise<boolean> {
  for (const { digest } of keyedDigestCandidates(normalise(code))) {
    const spent = await db
      .update(userRecoveryCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(userRecoveryCodes.userId, userId),
          eq(userRecoveryCodes.codeHash, digest),
          isNull(userRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: userRecoveryCodes.id });
    if (spent.length > 0) return true;
  }
  return false;
}
