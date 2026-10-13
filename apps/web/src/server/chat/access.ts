import type { ChatReadOnlyReason, TripDetail, TripRole } from "@tc/contracts";
import { COLLABORATORS_NOT_ENTITLED_CODE } from "../access/collaborationGate";
import { collaboratorsEntitled } from "../access/members";
import { requireTripAccess } from "../access/trip-access";
import { isDemoTripId } from "@/lib/demoTrip";

// The demo's refusal code, spelled as the assistant's (`server/assistant/
// admission.ts`) so a client branches on one string for both.
export const CHAT_DEMO_REFUSED_CODE = "demo-trip-unsupported";

// A post or an edit after the owner's lapse: the collaboration gate's own code
// and status, because it is the same gate. `satisfies` keeps it one of the
// contract's read-only reasons.
export const CHAT_NOT_ENTITLED_CODE = COLLABORATORS_NOT_ENTITLED_CODE satisfies ChatReadOnlyReason;

export type ChatAccess =
  | { error: Response }
  | { userId: string; role: TripRole; detail: TripDetail; canPost: boolean };

/**
 * May this session use this trip's chat, and may it post (ADR-073 §3, §5).
 * Every chat route asks this first; every request asks it again, so a member
 * removed between two requests is refused on the second.
 *
 * - **The demo is refused**, before the seam is asked: `requireTripAccess`
 *   with `allowDemo` answers the demo as a viewer, which would read as "may
 *   read", and every member may post.
 * - **Any member may read**, viewers and suggesters included.
 * - **A deleted trip is answered as gone.** The seam serves one with
 *   `status: "deleted"` (the trip page shows a restore banner), so this checks.
 *   Nothing is purged: restoring the trip brings the conversation back.
 * - **`canPost` is the owner's `trip.collaborators`**, for everyone, the owner
 *   included: after a lapse the chat stays readable and nobody posts or edits.
 *   Marking read and deleting are not new content, and stay allowed.
 */
export async function chatAccess(tripId: string): Promise<ChatAccess> {
  if (isDemoTripId(tripId)) {
    return {
      error: Response.json(
        { error: "Chat isn't available on the demo trip.", code: CHAT_DEMO_REFUSED_CODE },
        { status: 403 },
      ),
    };
  }
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access;
  if (access.detail.status === "deleted") {
    return { error: Response.json({ error: "not-found" }, { status: 404 }) };
  }
  return { ...access, canPost: await collaboratorsEntitled(access.detail.members) };
}

/** What a write answers when `canPost` is false: 402, as every refusal of this gate is. */
export function chatReadOnly(): Response {
  return Response.json(
    {
      error: "This trip's chat is read-only: its owner's plan no longer includes collaborators.",
      code: CHAT_NOT_ENTITLED_CODE,
    },
    { status: 402 },
  );
}
