import { InviteRole, type TripMember, type TripRole } from "@tc/contracts";

/**
 * **Does the reader own this trip?** — M26 link 6b.
 *
 * Home's per-card menu offered **Delete** unconditionally, so a non-owner was
 * shown a verb the server refuses (`MINIMUM_ROLE.DeleteTrip = "owner"`): a
 * control that appears to do something and does nothing, on the one screen
 * where a shared trip is most likely to be seen. SPEC §27 says what belongs
 * there instead — *Leave this trip*.
 *
 * **Derived client-side from what `TripSummary` already carries**, rather than
 * from a new `myRole` field on the trip-list projection. `TripSummary.members`
 * is `TripMember[]` and `TripMember` carries `role`, so the answer is already
 * on the wire; the milestone's *"and `myRole` on the trip-list projection"* was
 * describing work that had already been done by something else. `memberRole`
 * in `server/accessPolicy.ts` answers the same question server-side and cannot
 * be imported here — the UI/server lint wall (AGENTS.md invariant 6) bars it —
 * so this is the UI's own copy of one comparison, not a second policy.
 *
 * **It is a display gate, never an authorisation.** The server decides; this
 * only decides which verb to offer. `undefined` (the session probe still in
 * flight) answers `false`, which offers the milder verb — a wrong *Leave* on
 * your own trip is a refused request, where a wrong *Delete* on somebody
 * else's would be too, but reads as the app not knowing whose trip it is.
 */
export function viewerOwnsTrip(
  members: readonly TripMember[],
  userId: string | null | undefined,
): boolean {
  if (userId === null || userId === undefined || userId === "") return false;
  return members.some((m) => m.userId === userId && m.role === "owner");
}

/**
 * **What a role may do on the board** — W8 of the suggester spec
 * (docs/specs/2026-10-03-suggester-role-design.md).
 *
 * Every client gate used to be a literal `role === "viewer"`, which was right
 * while there were three roles and silently wrong once a middle rank arrived:
 * a suggester passed every one of those comparisons as a writer. One place
 * answers now, so the next role is one edit and a table row, not an audit.
 *
 * - `"read"`: no change to the trip at all.
 * - `"suggest"`: edits are held as a suggestion, never sent as commands — the
 *   server refuses a suggester's commands exactly as a viewer's.
 * - `"write"`: commands go straight to the trip.
 *
 * No role reads. A caller that keeps the board live through a FAILED access
 * read (TripProvider, SettingsSheet) says so itself before asking — that is a
 * judgement about the read, not about a role. Display only, as
 * `viewerOwnsTrip` is: the server decides.
 */
export function boardMode(role: TripRole | null | undefined): "read" | "suggest" | "write" {
  switch (role) {
    case "owner":
    case "editor":
      return "write";
    case "suggester":
      return "suggest";
    default:
      return "read";
  }
}

/**
 * Whether a role may edit the trip's notebooks. Spec §2.2 keeps the notebook
 * read-only for a suggester exactly as for a viewer — suggesting is the
 * board's alone — so this is not `boardMode !== "read"`.
 */
export function canEditNotebook(role: TripRole | null | undefined): boolean {
  return role === "editor" || role === "owner";
}

const ROLE_LABEL: Record<InviteRole, string> = {
  editor: "Can edit",
  suggester: "Can suggest",
  viewer: "Can view",
};

/**
 * What a role on offer is called on screen. Spec §2.1 names the suggester
 * "Can suggest" rather than by its enum word. A `Record`, so a new invite role
 * does not compile until it has a name.
 */
export function roleLabel(role: InviteRole): string {
  return ROLE_LABEL[role];
}

/**
 * The roles an owner may invite, in the order the picker offers them: most
 * capable first, so "Can edit" leads and the suggester sits between the two it
 * is between. Read off the contract rather than listed (review of #309), so a
 * role `InviteRole` gains is offered without this file being found — the
 * contract lists its roles least capable first, as `TripRole` does.
 */
/**
 * Who decides a suggester's changes, said the same way wherever a suggester
 * is told (spec W64): the invite landing, the look-first banner and the invite
 * email. They disagreed ("the planners" here, "the trip's editors" in the
 * email), and the owner, who also decides, is not an editor. "Planners" is the
 * word the invite copy already used for the people running a trip. Here, not
 * in either surface, because `lib/` is the one place both the UI and
 * `server/email` may import.
 */
export const SUGGESTER_APPROVAL = "for the trip's planners to approve";

export const INVITE_ROLES_OFFERED: readonly InviteRole[] = [...InviteRole.options].reverse();
