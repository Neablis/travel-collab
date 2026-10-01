import { CreateInviteInput, TripInvite } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { createInvite } from "@/server/access/invites";
import { accountCan } from "@/server/entitlements/resolver";
import { readContact } from "@/server/users";
import { sendEmail } from "@/server/email/send";
import { tripInviteEmail } from "@/server/email/templates";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import {
  COLLABORATORS_NOT_ENTITLED_CODE,
  COLLABORATORS_NOT_ENTITLED_REASON,
} from "@/server/access/collaborationGate";

// Owner-only, by the same argument the AccessPolicy table uses for DeleteTrip:
// an editor plans the trip, an owner decides who is on it.
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "owner");
  if ("error" in access) return access.error;
  if (access.detail.status === "deleted") {
    return Response.json({ error: "This trip has been deleted." }, { status: 400 });
  }
  // **The collaboration gate** (M20 link 6). Owner-only was already true; what
  // is new is that inviting anyone requires the entitlement, and CREATING AND
  // PLANNING A TRIP ALONE NEVER DOES — nothing above this line asks
  // Entitlements anything, which is what makes trip planning free by
  // construction rather than by a rule somebody has to remember.
  //
  // 402, not 403, and the refusal NAMES THE TIER. A free owner meets this gate
  // cold: `trip.collaborators` is never trialled, so nobody experiences
  // collaboration before paying for it, and a refusal reading as a permission
  // error would leave them with no idea what they had just met. No price — M20
  // never learns what a plan costs.
  //
  // The gate lives HERE, in Access & Membership, and reads a boolean out of
  // Entitlements (ADR-045 rule 5). That module never learns this capability is
  // about invites.
  if (!(await accountCan(access.userId, "trip.collaborators"))) {
    return Response.json(
      { error: COLLABORATORS_NOT_ENTITLED_REASON, code: COLLABORATORS_NOT_ENTITLED_CODE },
      { status: 402 },
    );
  }
  const body = CreateInviteInput.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-invite" }, { status: 400 });
  const invite = await createInvite(tripId, access.userId, body.data);
  // **An invite with an address is also emailed** — the link is still the
  // invite, and the panel still copies it, so a send that fails or is not
  // configured leaves the owner exactly where they were before email existed.
  // `emailed` rides beside the DTO rather than in it: it describes this
  // request, not the invite, and a reload of the list cannot know it.
  let emailed = false;
  if (invite.email !== null) {
    const inviter = await readContact(access.userId);
    const outcome = await sendEmail(
      tripInviteEmail({
        to: invite.email,
        inviterName: inviter.name,
        inviterEmail: inviter.email,
        tripName: access.detail.name,
        role: invite.role,
        inviteUrl: `${deploymentOrigin()}/invite/${encodeURIComponent(invite.token)}`,
      }),
    );
    emailed = outcome.sent;
  }
  return Response.json({ invite: TripInvite.parse(invite), emailed }, { status: 201 });
}
