/**
 * Where a public-library page goes "back" to.
 *
 * §15: *"Back links are contextual — the profile returns to day, board or
 * Discover depending on where you came from, because the same page is reachable
 * three ways."* The same is true of a shared day, which is reachable from
 * Discover and from a profile.
 *
 * Read from the query string rather than from history, deliberately. A
 * `router.back()` is not the same promise: it returns to wherever the browser
 * was, which after a reload, a shared URL or a middle-click is not the page the
 * link claims. Encoding the origin in the URL means the label and the
 * destination cannot disagree, and a pasted link still has an honest way out.
 *
 * A `from` this does not recognise falls back to Discover — the one page that
 * is always a sensible place to end up, and the reason this returns a value for
 * every input rather than null for some.
 */
export type BackTarget = { href: string; label: string };

const DISCOVER: BackTarget = { href: "/playbooks", label: "Discover" };

export function backTarget(params: {
  from?: string | null;
  /** The day to return to, when `from` is `day`. */
  day?: string | null;
  /** The person whose profile to return to, when `from` is `profile`. */
  profile?: string | null;
}): BackTarget {
  if (params.from === "board") return { href: "/playbooks/board", label: "Who shares the most" };
  if (params.from === "day" && params.day) {
    return { href: `/playbooks/day/${encodeURIComponent(params.day)}`, label: "the day" };
  }
  // A day opened from somebody's profile returns to that profile. Without this
  // the only origin a day link could carry was none, so every day went back to
  // Discover — including the ones reached from a profile, which is the case
  // §15's "returns to whichever it came from" names (CodeRabbit, PR 102).
  if (params.from === "profile" && params.profile) {
    return {
      href: `/playbooks/profile/${encodeURIComponent(params.profile)}`,
      label: "the profile",
    };
  }
  return DISCOVER;
}

/**
 * The origin a link INTO a library page carries, so that page's back link can
 * name where it came from.
 *
 * The write half of `backTarget`, here rather than spelled at each call site:
 * the two have to agree about the parameter names, and a link that spelled
 * `?person=` would produce a back link to Discover with nothing to say it had
 * gone wrong.
 */
export type BackOrigin =
  | { from: "playbooks" }
  | { from: "board" }
  | { from: "day"; day: string }
  | { from: "profile"; profile: string };

export function backQuery(origin: BackOrigin): string {
  const params = new URLSearchParams({ from: origin.from });
  if (origin.from === "day") params.set("day", origin.day);
  if (origin.from === "profile") params.set("profile", origin.profile);
  return `?${params.toString()}`;
}
