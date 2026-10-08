import { eq, sql } from "drizzle-orm";
import { displayNameFor, firstNameOf } from "@/lib/displayName";
import { REFERRAL_CARD_TTL_SECONDS, referralCardKey } from "../cache/keys";
import { getCache, type CachePort } from "../cache/redis";
import { db } from "../db/client";
import { inviteCodes, users } from "../db/schema";

// Spec 2026-09-27 §2.1: the referral link is `/signup?code=<CODE>`, and its
// card says who sent it. `invite_codes.created_by` is the referrer.
//
// **A redeemed code keeps the name.** The referrer shared that code on purpose,
// and chat apps cache the first unfurl whatever we answer later.
//
// **This is a lookup M11a decided not to have** — `server/admission.ts` refuses
// an "is this code valid?" route as a brute-force oracle — and the card is one,
// in a narrow form: a known code draws a name, an unknown one does not. What
// makes that acceptable is the code, not a limiter: ten characters drawn
// uniformly from 31 symbols (`entitlements/referrals.ts`), about 49 bits, so
// finding one by guessing is not a thing an unfurl-rate loop can do. The super
// code is never looked up here — only `invite_codes` is read — so the card
// cannot become an oracle for it.
//
// Cached in the shared Redis (ADR-059) for a day, named referrers only: an
// unknown code writes nothing, so guessing cannot fill the free tier. Stored as
// an object rather than a bare string, because the client JSON-decodes what it
// reads and a name like "123" would come back as a number.
/**
 * The first name of whoever minted referral `code`, or `null` when no such code
 * exists or its minter has no name to give.
 */
export async function referrerFirstNameFor(code: string, cache: CachePort = getCache()): Promise<string | null> {
  const key = referralCardKey(code);
  const cached = await cache.get<{ firstName: string }>(key);
  if (typeof cached?.firstName === "string") return cached.firstName;
  const firstName = await lookUp(code);
  if (firstName !== null) await cache.set(key, { firstName }, REFERRAL_CARD_TTL_SECONDS);
  return firstName;
}

async function lookUp(code: string): Promise<string | null> {
  const [row] = await db
    .select({
      userId: inviteCodes.createdBy,
      name: users.name,
      // The chosen name only when its owner opted in (M38 D2): an unfurl is a
      // public page, so it follows the library's rule rather than the trip's.
      displayName: sql<string | null>`case when ${users.publicDisplayName} then ${users.displayName} end`,
    })
    .from(inviteCodes)
    .innerJoin(users, eq(users.id, inviteCodes.createdBy))
    .where(eq(inviteCodes.code, code))
    .limit(1);
  if (row === undefined) return null;
  // `email: null` drops the address link of the chain, as the invite landing
  // does. The second argument is the bare-id handle, so an account with no
  // name at all yields `null` rather than "Traveler invited you".
  const full = displayNameFor({ userId: row.userId, displayName: row.displayName, name: row.name, email: null });
  return firstNameOf(full, displayNameFor({ userId: row.userId }));
}
