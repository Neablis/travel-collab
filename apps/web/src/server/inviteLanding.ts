import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { InviteLanding, InviteLandingDay, InviteLandingLeg, TripDetail, TripMember } from "@tc/contracts";
import { cityFor } from "@/lib/dayChips";
import { displayNameFor, firstNameOf } from "@/lib/displayName";
import { db } from "./db/client";
import { users } from "./db/schema";
import { inviteByToken } from "./access/invites";
import { grantedMembers, mergeMembers } from "./access/members";
import { getTripDetail } from "./projections";

/**
 * The invite landing (M27 link 6, SPEC §35.6), composed.
 *
 * **Composed HERE, not in `access/`.** Access & Membership owns the invite and
 * does not know what a trip contains (AGENTS.md module map), and the landing is
 * mostly about the trip: its days, its cities, its stops. So this module asks
 * Access for the invite and the member list, asks Planning's read model for the
 * trip, asks Identity's table for names, and is the only place the three meet.
 *
 * **Public.** The route calls this with no session at all — an invite link is
 * opened by people who have no account yet. What keeps that safe is the order
 * below: every refusal is decided before the trip is summarised, and the three
 * refusals carry nothing but their state (the contract's `.strict()` objects
 * enforce it at the route's parse). The token is the credential (ADR-026), so a
 * PENDING token's holder is told what they could join; nobody else is told
 * anything (#71 review §7, M27 D10).
 */
export async function readInviteLanding(
  token: string,
  viewerId: string | null,
): Promise<{ status: number; landing: InviteLanding }> {
  const signedIn = viewerId !== null;
  const invite = await inviteByToken(token);
  if (invite === null) {
    return unavailable(404, signedIn, "This invite link is not valid.");
  }
  // `getTripDetail` THROWS on a stored doc it cannot parse (and logs the
  // issues first), so the catch is `readTrip`'s (access/trip-access.ts): only
  // the parse failure is converted. Uncaught, it was a 500 — the one answer
  // the landing offers Try again for, on a read that could never succeed.
  //
  // `mergeMembers` over the raw grants rather than `effectiveMembers`: the
  // question is whether the reader is ON the trip, which a lapsed owner's cap
  // (a role change, never a removal) cannot alter — so it is not worth a trip
  // to Entitlements on a public read.
  let detail: TripDetail | null;
  let grants: TripMember[];
  try {
    [detail, grants] = await Promise.all([getTripDetail(invite.tripId), grantedMembers(db, invite.tripId)]);
  } catch (error) {
    if (error instanceof z.ZodError) return unavailable(410, signedIn, "This trip is no longer available.");
    throw error;
  }
  if (detail === null || detail.status === "deleted") {
    return unavailable(410, signedIn, "This trip is no longer available.");
  }
  const members = mergeMembers(detail.members, grants);
  // Before the status checks, deliberately: a person who spent this link is on
  // the trip, and "you're already here" is the useful answer to following your
  // own link twice — not "this link has been used".
  if (viewerId !== null && members.some((m) => m.userId === viewerId)) {
    return { status: 200, landing: { state: "member", signedIn: true, tripId: detail.tripId, tripName: detail.name } };
  }
  if (invite.status === "revoked") {
    return { status: 410, landing: { state: "revoked", signedIn } };
  }
  if (invite.status === "accepted") {
    // Somebody else's now. `acceptInvite` already tells a holder this in the
    // same words, so saying it here discloses nothing new.
    return unavailable(410, signedIn, "This invite has already been used.");
  }

  const names = await namesFor([invite.invitedBy, ...members.map((m) => m.userId)]);
  const plan = summarizePlan(detail);
  return {
    status: 200,
    landing: {
      state: "valid",
      signedIn,
      tripId: detail.tripId,
      role: invite.role,
      sentAt: invite.createdAt,
      recipientEmail: invite.email,
      inviterName: names(invite.invitedBy),
      trip: {
        name: detail.name,
        startDate: detail.days[0]?.date ?? detail.startDate,
        dayCount: detail.days.length,
        cityCount: plan.cityCount,
        stopCount: plan.stopCount,
      },
      days: plan.days,
      legs: plan.legs,
      // First names (SPEC §35.6).
      crew: members.map((m) => firstNameOf(names(m.userId))),
    },
  };
}

function unavailable(
  status: number,
  signedIn: boolean,
  message: string,
): { status: number; landing: InviteLanding } {
  return { status, landing: { state: "unavailable", signedIn, message } };
}

/**
 * What to call each person, WITHOUT the email link of `displayNameFor`'s chain.
 *
 * The chain ends `?? email ?? handle`, and on this page that would print a
 * crew member's address to a stranger. Passing `email: null` drops exactly that
 * link and keeps the rest — a chosen display name, the provider's name, and the
 * id-free handle — so there is still one resolver (the M17 seam), not a second.
 */
async function namesFor(userIds: readonly string[]): Promise<(userId: string) => string> {
  const ids = [...new Set(userIds)];
  const rows = await db
    .select({ id: users.id, name: users.name, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (userId) => {
    const row = byId.get(userId);
    return displayNameFor({ userId, displayName: row?.displayName, name: row?.name, email: null });
  };
}

export type PlanSummary = {
  days: InviteLandingDay[];
  legs: InviteLandingLeg[];
  cityCount: number;
  stopCount: number;
};

/** At most this many stop titles per leg (SPEC §35.6: "up to three highlights"). */
const HIGHLIGHTS_PER_LEG = 3;

/**
 * The plan so far, as the landing's card draws it: one entry per day for the
 * ribbon, and one leg per run of consecutive days in the same city.
 *
 * A day's city is `cityFor` — the same derivation the board's day chips use —
 * so a leg here is the run the board would colour as one. A day with no city
 * is its own run (`city: null`), never folded into a neighbour: saying the
 * Kyoto leg includes a day nobody has placed would claim a plan that does not
 * exist.
 *
 * Highlights skip transit stops and lodging, which is how the design's own
 * filter (*"transit and check-in stops skipped"*) maps onto this model: a
 * train is `kind: "transit"`, a check-in is a stop tagged `lodging`.
 *
 * Pure, and exported for its unit test.
 */
export function summarizePlan(detail: TripDetail): PlanSummary {
  const days: InviteLandingDay[] = detail.days.map((day) => ({
    city: cityFor(day, detail.activities),
    stopCount: day.activityIds.length,
  }));
  const legs: InviteLandingLeg[] = [];
  detail.days.forEach((day, index) => {
    const city = days[index]!.city;
    const titles = day.activityIds.flatMap((id) => {
      const stop = detail.activities[id];
      return stop === undefined || stop.kind === "transit" || stop.tags.includes("lodging") ? [] : [stop.title];
    });
    const last = legs[legs.length - 1];
    if (last !== undefined && last.city === city) {
      last.dayTo = index + 1;
      last.stopCount += day.activityIds.length;
      last.highlights = [...last.highlights, ...titles].slice(0, HIGHLIGHTS_PER_LEG);
    } else {
      legs.push({
        city,
        dayFrom: index + 1,
        dayTo: index + 1,
        stopCount: day.activityIds.length,
        highlights: titles.slice(0, HIGHLIGHTS_PER_LEG),
      });
    }
  });
  return {
    days,
    legs,
    cityCount: new Set(days.map((d) => d.city).filter((c) => c !== null)).size,
    stopCount: days.reduce((sum, d) => sum + d.stopCount, 0),
  };
}
