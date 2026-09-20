import { requireTripAccess } from "@/server/access/trip-access";
import { removeMember } from "@/server/access/members";
import { getTripDetail } from "@/server/projections";

/**
 * **Leave this trip** — M26 link 6b, SPEC §27: *"a trip someone shared with you
 * offers Leave this trip"*.
 *
 * `members.ts` already named the shape of this: *"an owner-only endpoint cannot
 * express it, and self-removal for a guest is a product surface, not a
 * permission tweak."* This is that product surface, and it is a route of its
 * own rather than a widening of `DELETE .../members/[userId]` for two reasons.
 *
 * **The authorisation is a different question.** That endpoint asks "are you
 * this trip's owner"; this one asks "is the person you are removing you". One
 * handler answering both would decide per request which rule applied, which is
 * how the looser of two rules eventually leaks onto the stricter path.
 *
 * **And the response cannot be the same.** `.../members/[userId]` answers with
 * the trip's `TripAccess` — who is on it now — because the Travelers panel
 * re-renders from the mutation. Serving that to somebody who just left the trip
 * would hand a non-member the trip's member list, one request after taking
 * their access away. `{ ok: true }` is the whole of what the caller needs: its
 * next act is to drop the card.
 *
 * **No new verb in the planning log**, and this is ADR-003 rather than a
 * shortcut: access is CRUD, not event-sourced. Membership rows are the Access
 * module's, `TripCreated` is the only thing that mints an owner, and inventing
 * a planning event to carry a membership change is the boundary smell AGENTS.md
 * invariant 1 names. The milestone called this "a `LeaveTrip` verb"; the verb
 * is real, the event is not, and that difference is the architecture working.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  // `viewer`, the lowest rank there is: every kind of guest can leave, and an
  // editor leaving is the same act as a viewer leaving. No `allowDemo` — the
  // demo grants a visitor `viewer` with no session and no membership row, so a
  // leave there would be a 404 dressed as a feature.
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access.error;

  // The PLANNING LOG's member list, for the same reason the sibling route
  // insists on it: `removeMember`'s owner rule is about who the trip's owner
  // IS, not about who currently ranks as one.
  const projected = await getTripDetail(tripId);
  if (projected === null) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const outcome = await removeMember(tripId, access.userId, projected.members);
  if (outcome === "owner") {
    // 409, matching the sibling: the caller is allowed to act on this trip —
    // it is this particular membership that cannot be expressed as a row,
    // because it comes from `TripCreated`. The message names the verb that
    // WOULD work, because an owner who wants rid of a trip has one.
    return Response.json(
      { error: "You own this trip, so there is nothing to leave. Delete it instead." },
      { status: 409 },
    );
  }
  if (outcome === "not-a-member") {
    // Reachable only if the access above came from somewhere other than a
    // membership row. Answered rather than assumed away: a 200 here would tell
    // somebody they had left a trip that is about to reappear in their list.
    return Response.json({ error: "You are not a member of this trip." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
