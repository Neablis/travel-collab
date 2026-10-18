// Which copy of a public library page a request is served, decided in
// `proxy.ts` before anything renders (candidate "Public playbook pages become
// cacheable", from the PR 481 audit; Mitchell chose the split, 2026-10-18).
//
// Every `/playbooks/**` URL is rewritten to `/playbooks/<reader>/**`: the pages
// live once, in `app/playbooks/live`, and `app/playbooks/[copy]` re-exports
// them as the cached copy (its layout says why it is two trees). They render
// two ways:
//
// - **`cached`**, for a reader with no session asking for a URL with no query
//   string. Its layout reads no cookies and its pages read neither `auth()` nor
//   `searchParams`, so Next renders it once and the CDN serves it until a
//   publish, an unpublish or a day passes (the reads are tagged, ADR-063).
// - **`live`**, for everyone else: per request, as every playbook page was
//   before. A signed-in reader keeps what the `(app)` layout serves them — the
//   plan in the first HTML (M45 decision 3), their preferences, Saved, and
//   their own private day — and a query string (`?city=`, `?page=`, `?from=`)
//   keeps the answer it names.
//
// A reader with no session never saw an Ask, a Saved tab or a private day, so
// the cached copy is the page they were already shown, from a cache.
export type PlaybooksReader = "live" | "cached";

// Nothing a playbook page reads: Next's own `_rsc`, and the campaign tags a
// shared link picks up on its way through a feed. A URL carrying only these is
// still the plain page.
const IGNORED_PARAM = /^(?:_rsc|utm_[a-z_]+|fbclid|gclid)$/;

/** The copy a request is served: `cached` only with no session and nothing in the query a page reads. */
export function playbooksReaderFor(signedIn: boolean, searchParams: URLSearchParams): PlaybooksReader {
  if (signedIn) return "live";
  for (const key of searchParams.keys()) if (!IGNORED_PARAM.test(key)) return "live";
  return "cached";
}

/** `/playbooks/<rest>` as the route that renders it, `/playbooks/<reader>/<rest>`; null for any other path. */
export function playbooksRoute(pathname: string, reader: PlaybooksReader): string | null {
  const rest = /^\/playbooks(\/.*)?$/.exec(pathname);
  if (rest === null) return null;
  return `/playbooks/${reader}${rest[1] ?? ""}`;
}
