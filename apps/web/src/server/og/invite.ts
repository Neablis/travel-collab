import { firstNameOf } from "@/lib/displayName";
import { INVITE_CARD_TTL_SECONDS, inviteCardKey } from "../cache/keys";
import { getCache, type CachePort } from "../cache/redis";
import { readInviteLanding } from "../inviteLanding";

/** How many crew names the card prints before it says "+N". */
export const CREW_SHOWN = 3;

/**
 * What the invite link-preview card prints, and nothing else.
 *
 * `personal` carries first names and counts only: no email, no surname, no
 * photo, no role, no recipient. An unfurler is a stranger holding the token, so
 * the card says no more than the public landing's own header does (SPEC §35.6),
 * and less than its body.
 */
export type InviteCard =
  | {
      kind: "personal";
      inviterFirstName: string;
      tripName: string;
      startDate: string | null;
      dayCount: number;
      cityCount: number;
      crew: string[];
      crewOverflow: number;
    }
  | { kind: "generic" };

// Spec 2026-09-27 §2.1. An unfurler has no session, so `readInviteLanding` is
// asked with no viewer and can never answer `member`. Every answer that is not
// `valid` (revoked, used, unknown, trip gone) becomes the generic card rather
// than the landing's own refusal copy: the token is the only thing that was
// shared, and once it is revoked it must stop saying who sent it.
//
// Cached in the shared Redis (ADR-059) for an hour, PERSONAL cards only: a
// generic answer is cheap to recompute and is what a junk token gets, so
// writing it would let anyone fill the free tier. `revokeInvite` and
// `acceptInvite` delete the key, so a spent invite goes generic at once here
// (the CDN's own hour is `card.tsx`'s trade-off).
/**
 * The invite card for `token`: the inviter's first name, the trip and its crew
 * when the invite is pending, and the generic card for anything else.
 */
export async function inviteCardFor(token: string, cache: CachePort = getCache()): Promise<InviteCard> {
  const key = inviteCardKey(token);
  const cached = await cache.get<InviteCard>(key);
  if (cached?.kind === "personal") return cached;
  const card = await lookUp(token);
  if (card.kind === "personal") await cache.set(key, card, INVITE_CARD_TTL_SECONDS);
  return card;
}

async function lookUp(token: string): Promise<InviteCard> {
  const { landing, crew: members = [] } = await readInviteLanding(token, null);
  if (landing.state !== "valid") return { kind: "generic" };
  // `inviterName` is `displayNameFor`'s whole answer ("Dana Reyes"), resolved
  // with `email: null` so it is never an address. The crew are first names
  // already, and leave out the inviter, who is the headline: "Dana invited
  // you … with Mei, Priya", not "… with Dana, Mei".
  const crew = members.filter((m) => !m.isInviter && m.firstName !== "").map((m) => m.firstName);
  return {
    kind: "personal",
    inviterFirstName: firstNameOf(landing.inviterName),
    tripName: landing.trip.name,
    startDate: landing.trip.startDate,
    dayCount: landing.trip.dayCount,
    cityCount: landing.trip.cityCount,
    crew: crew.slice(0, CREW_SHOWN),
    crewOverflow: Math.max(crew.length - CREW_SHOWN, 0),
  };
}
