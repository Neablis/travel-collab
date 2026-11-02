/**
 * The booking link as something safe to follow, or null. A read-side snapshot
 * is not re-validated (M44 part 2's review), and `javascript:` is a valid URL,
 * so an href is only ever made from what parses with an http: or https:
 * protocol. The one place that decides it, for the card and the editor alike.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
