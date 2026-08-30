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
  return who.name ?? who.email ?? who.userId;
}
