// The public library's URLs, built and read in one place (SEO pass, D7). Pure,
// so the server pages, the client link builders and the sitemap share it.
//
// A day's URL is `/playbooks/day/<slug>-<uuid>`. The slug is DERIVED from the
// day's name on every build and stored nowhere; the uuid alone resolves the
// day. A link whose slug is missing or stale still opens: the page redirects
// it to the current URL.

const MAX_SLUG_LENGTH = 60;
const UUID_AT_END = /(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Lowercase ASCII words joined by hyphens, at most 60 characters; empty when the text has none. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
}

/** A day's route segment: `<slug>-<uuid>`, or the bare uuid when its name has no slug. */
export function daySegment(day: { savedDayId: string; name: string }): string {
  const slug = slugify(day.name);
  return slug === "" ? day.savedDayId : `${slug}-${day.savedDayId}`;
}

/** A day's canonical path, `/playbooks/day/<slug>-<uuid>`. */
export function dayPath(day: { savedDayId: string; name: string }): string {
  return `/playbooks/day/${daySegment(day)}`;
}

/** The uuid at the end of a day segment (lowercased), or null; and whatever slug came before it. */
export function parseDaySegment(segment: string): { id: string | null; slug: string } {
  const match = UUID_AT_END.exec(segment);
  if (match === null) return { id: null, slug: "" };
  const id = match[1]!.toLowerCase();
  return { id, slug: segment.slice(0, segment.length - id.length).replace(/-$/, "") };
}
