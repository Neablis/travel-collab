import type { ActivityKind } from "./activity.ts";
import type { Money } from "./money.ts";

// **A stop's price is per person** (ADR-060). These functions are the only
// place that reading is written down. The domain's `rollupCosts`, the server's
// read-time recost, `apps/web/src/lib/cost.ts` and every `@tc/pages` cost widget
// call them, which is why they live in contracts: a second copy of "price ×
// headcount" in any one of those is a total that can disagree with the board's
// (invariant 5).

/**
 * Who on a trip is travelling, in member order (travellers spec D1). A member
 * with no `travelling` reads as travelling — `TripMember`'s default (D2) — so a
 * caller holding an unparsed row counts the same people the schema would.
 *
 * This is "everyone" wherever nobody is picked. Who may be *picked*, and who
 * may be Booked by, is still every member (D6, D7).
 */
export function travellerIds(members: readonly { userId: string; travelling?: boolean }[]): string[] {
  return members.filter((m) => m.travelling !== false).map((m) => m.userId);
}

/**
 * How many people a stop is priced for: the people picked in *Who is in*, or
 * every **traveller** when nobody is picked (ADR-060 decision 2, as amended by
 * the travellers spec). A picked non-traveller counts: explicit beats default
 * (D6).
 *
 * `travellerCount` is `travellerIds(members).length` over the EFFECTIVE members
 * at read time, not the log's. It is never trusted below 1 (D5): the owner may
 * be planning a trip nobody on it is travelling, and a zero would make every
 * price vanish.
 *
 * People are counted by distinct id. `participants` is not constrained unique
 * and the log keeps what it was given, so a repeated id is one person, not two
 * charges.
 */
export function stopHeadcount(activity: { participants: readonly string[] }, travellerCount: number): number {
  const picked = new Set(activity.participants).size;
  return picked > 0 ? picked : Math.max(travellerCount, 1);
}

/**
 * A stop's whole price in minor units: per-person `cost` × headcount, or 0 when
 * it has no cost. `travellerCount` as for `stopHeadcount`.
 */
export function stopTotal(
  activity: { cost?: Money | null; participants: readonly string[] },
  travellerCount: number,
): number {
  if (!activity.cost) return 0;
  return activity.cost.amountMinor * stopHeadcount(activity, travellerCount);
}

/**
 * Whether a stop's cost is committed or still an estimate. It is the stop's
 * kind and nothing else (ADR-060 decision 5): a `pending` stop is not decided,
 * so its price is a guess. There is no second field that could disagree.
 */
export function isCommittedCost(kind: ActivityKind): boolean {
  return kind !== "pending";
}

/**
 * Who is in a stop: the people picked in *Who is in*, each once, or every
 * traveller when nobody is (ADR-060 decision 2; travellers spec D6).
 * `stopHeadcount` is this list's length whenever the trip has a traveller.
 * With none (D5) this is empty while `stopHeadcount` floors at 1: there is
 * nobody to charge, though the board still prices the stop for one.
 */
export function stopPeople(
  activity: { participants: readonly string[] },
  travellerIds: readonly string[],
): readonly string[] {
  // Distinct, as `stopHeadcount` counts: a repeated id is one person, so it
  // owes one share of a total that charged one head for it.
  return activity.participants.length > 0 ? [...new Set(activity.participants)] : travellerIds;
}

/** One person's side of the trip's money, in minor units of the one currency the caller summed. */
export interface MemberBalance {
  userId: string;
  /** What they are in for: `cost` for every priced stop they are in. */
  share: number;
  /** What they put up: the whole total of every priced stop they booked. */
  paid: number;
  /** `paid − share`. Above 0 the group owes them; below 0 they owe the group. */
  net: number;
  /**
   * Not in `memberIds`: somebody who has left but is still a stop's `bookedBy`
   * or one of its participants. A read model keeps such ids on purpose
   * (`ActivityView`), and the money they paid or owe did not leave with them —
   * dropping them would make the balances stop adding up.
   */
  former: boolean;
}

export interface Balances {
  /** Every member — traveller or not — in `memberIds` order, then any former member in the order the stops name them. */
  perMember: MemberBalance[];
  /** The total of every priced stop nobody booked: owed to the trip, not to a person. */
  unpaid: number;
}

/**
 * Who owes what (ADR-060 decision 6). For each priced stop, every person in it
 * (`stopPeople`: the picked, or the travellers) owes `cost` to its `bookedBy`,
 * who is credited the stop's whole total; a stop with no `bookedBy` is **not
 * paid yet**, so its total goes to `unpaid` and its people's shares are still
 * theirs. The payer's own share cancels inside their `net`.
 *
 * Two lists, because they answer different questions. `memberIds` is who gets
 * a row and who is not `former` — a non-traveller can still pay (D7) or be
 * picked (D6). `travellerIds` is who "everyone" is on a stop nobody picked.
 *
 * **It always balances: Σ net = −unpaid.** Every unit owed is credited to a
 * payer or to `unpaid`, so this holds for every input — former members
 * included, which is why they are listed rather than dropped.
 *
 * Amounts are added as they are, so the caller hands it stops in ONE currency
 * (`cost.chart`'s rule: a sum of yen and dollars is a wrong sum). A model of
 * who owes what; it moves no money (M19, *Explicitly not here*).
 */
export function balances(
  activities: Iterable<{ cost?: Money | null; participants: readonly string[]; bookedBy?: string | null }>,
  memberIds: readonly string[],
  travellerIds: readonly string[],
): Balances {
  const members = new Set(memberIds);
  const rows = new Map<string, MemberBalance>();
  const row = (userId: string): MemberBalance => {
    let found = rows.get(userId);
    if (!found) {
      found = { userId, share: 0, paid: 0, net: 0, former: !members.has(userId) };
      rows.set(userId, found);
    }
    return found;
  };
  for (const userId of memberIds) row(userId);

  let unpaid = 0;
  for (const activity of activities) {
    if (!activity.cost || activity.cost.amountMinor === 0) continue;
    const people = stopPeople(activity, travellerIds);
    if (people.length === 0) continue;
    for (const userId of people) row(userId).share += activity.cost.amountMinor;
    // `stopTotal` is `cost × people.length` here, since `people` is not empty.
    const total = stopTotal(activity, travellerIds.length);
    if (activity.bookedBy) row(activity.bookedBy).paid += total;
    else unpaid += total;
  }
  for (const r of rows.values()) r.net = r.paid - r.share;
  return { perMember: [...rows.values()], unpaid };
}
