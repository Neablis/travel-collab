// **How the first operator exists at all** (M20 link 7).
//
// The console is gated on `users.is_admin`, and nothing in the product sets it:
// granting is the console's only write and it writes `entitlement_grants`, not
// this column. Without a bootstrap the first operator cannot be made without a
// psql session, and an operator surface nobody can reach is an operator surface
// that does not exist. Found by trying to walk the gate end to end.
//
// **An allowlist of ids in the environment, read at sign-in.** The column stays
// the single source of truth for every READ — nothing else consults this — and
// this only ever **promotes**: an id in the list is made an operator on its
// next sign-in, and an id removed from the list keeps the bit until somebody
// takes it away deliberately. Demoting on absence would mean a deploy that
// forgot the variable silently locking every operator out of the console, which
// is the failure you notice at the worst moment.
//
// Lives in `src/lib` rather than `src/server` so it is a plain env read with no
// I/O, the same placement and the same reasoning as `isDemoDataResetEnabled`.
//
// Fails closed on anything malformed: an unparseable list is an empty list, and
// an empty list promotes nobody.

/** Ids, comma-separated, exactly as they appear in `users.id` (e.g. `dev-ana`). */
export function bootstrapAdminIds(): string[] {
  const raw = process.env.ADMIN_USER_IDS;
  if (typeof raw !== "string" || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
}

/** Should this id be an operator by configuration. Exact match, never a prefix. */
export function isBootstrapAdmin(userId: string): boolean {
  return bootstrapAdminIds().includes(userId);
}
