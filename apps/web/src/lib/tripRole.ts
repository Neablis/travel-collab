import type { TripMember } from "@tc/contracts";

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
