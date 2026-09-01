/**
 * The ONE place `who` becomes something to call a person — the M17 seam.
 *
 * **This is a recorded decision, not an implementation gap.** M17 (preferences)
 * was moved to AFTER M11b, and M17 is what resolves an account to a chosen
 * display name. `M11b-playbooks-public-library.md`'s Prerequisites section
 * spells out the consequence and the shape of the answer: link 6's author strip
 * and link 8's public profile both show a person's name, both build against the
 * identifier that exists today, and both go through a SINGLE resolver so that
 * M17 fills them in by changing this function rather than two routes.
 *
 * > "Do not scatter the fallback across the two routes; if a second call site
 * > appears, the seam has been built wrong."
 *
 * "A second call site" means a second *implementation* of the fallback. Every
 * surface that needs a name calls THIS; nothing else spells out
 * `name ?? email ?? userId`. `TravelersPanel` had the original copy of that
 * expression and now delegates here, which is what makes this the only one.
 *
 * The saved-day surfaces have strictly less to work with than TravelersPanel
 * does: a `saved_days` row carries `owner_id` and nothing else — no join to
 * `users` is made, because §15 is explicit that a public profile needs **no
 * public user record**, and inventing one to hold a name would be building the
 * thing M17 is going to build. So those callers pass `{ userId }` alone and get
 * the identifier back, honestly, until M17 has something better to return.
 */
export type NameableUser = {
  userId: string;
  name?: string | null;
  email?: string | null;
};

export function displayNameFor(who: NameableUser): string {
  return who.name ?? who.email ?? handleFor(who.userId);
}

/**
 * The last resort: something to call a person when all we hold is their id.
 *
 * **Never the raw identifier.** Mitchell, 2026-09-01, on the shared-day
 * screen: *"Dont show the UUID in the Header bar where publish button is"* —
 * a Google `sub` is a 21-digit number and every other id here is a UUID, and
 * either one rendered as a name reads as the page failing rather than as a
 * person. The id is still what the profile LINK carries; this is only what the
 * link says.
 *
 * Two shapes, because two exist:
 *
 *   * `dev-alice` → `Alice`. A dev-login id is a username someone typed
 *     (`devLoginIdentity` lowercases and bounds it to `[A-Za-z0-9_-]`), so the
 *     readable name really is in there and nothing is invented by taking it.
 *   * anything else → `Traveler 4f2a91`. Six hex-ish characters off the end of
 *     the id: short enough to still read as a name and not an identifier, and
 *     stable across renders and deploys. Widened from four (CodeRabbit, pull
 *     request 104): a UUID's trailing characters are close to uniformly
 *     distributed,
 *     so four of them collide across two different ids far too easily for
 *     what this label is used for — the leaderboard and public profiles rank
 *     people against each other by it, and two people rendering as the exact
 *     same "Traveler xxxx" is not a cosmetic bug there, it's a wrong ranking.
 *     Six hex characters is 16^6 (~16.8M) rather than 16^4 (~65K) — the
 *     shortest widening that makes a realistic collision actually
 *     unreachable, not just less likely, while a Google `sub`'s trailing
 *     digits (10^6, ~1M) still comfortably outrun this app's population. A
 *     flat "Traveler" would make every row on that page the same person; the
 *     suffix is what stops that, at either width.
 *
 * This stays the M17 seam it always was: when accounts gain a chosen display
 * name, `name` arrives populated and this branch stops being reached.
 */
function handleFor(userId: string): string {
  const dev = /^dev-(.+)$/.exec(userId);
  if (dev?.[1] !== undefined && dev[1] !== "") {
    const username = dev[1];
    return username.charAt(0).toUpperCase() + username.slice(1);
  }
  // `replace` first: a UUID's dashes are not part of the suffix anyone would
  // read, and an id shorter than six characters keeps whatever it has rather
  // than being padded into a shape it does not have.
  const compact = userId.replace(/[^A-Za-z0-9]/g, "");
  const suffix = compact.slice(-6);
  return suffix === "" ? "A traveler" : `Traveler ${suffix}`;
}
