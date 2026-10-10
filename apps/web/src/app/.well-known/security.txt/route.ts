// **RFC 9116 `GET /.well-known/security.txt`.** Where a researcher or a
// scanner looks to find out how to report a vulnerability. It says what
// `SECURITY.md` says, in the format they expect: exploitable findings go to a
// private GitHub security advisory, everything else to GitHub Issues.
//
// **`Expires` is a fixed date, on purpose.** RFC 9116 makes it required and
// recommends under a year out, so a file whose contacts went stale stops being
// trusted. Computing it per request would defeat that. Refresh the date when
// you re-read the contacts below.
//
// **`Canonical` comes from the request's origin**, the same construction as
// `api-catalog/route.ts`, so a preview names itself rather than production.
//
// A plain static handler: no auth, no server imports. It sits under the
// `.well-known/**/route.ts` lint-wall exemption only because every route here
// does. Reachability for bots is the firewall's call, as for the api-catalog —
// see `docs/guidelines/using-the-api.md`.

const REPO = "https://github.com/Neablis/travel-collab";

/** When the contacts below were last confirmed, plus under a year. */
const EXPIRES = "2027-10-01T00:00:00.000Z";

/** The security.txt document for `origin`. */
function securityTxt(origin: string): string {
  return [
    "# Caesura (travel-collab) security contact.",
    "#",
    "# Found something exploitable? Report it privately: open a GitHub security",
    "# advisory (the first Contact below, or Security -> Report a vulnerability on",
    "# the repository). Do not open a public issue for it.",
    "#",
    "# Found a bug that is not a security problem? File a GitHub issue:",
    `#   ${REPO}/issues/new`,
    "# Say what you did, what you expected and what happened instead, and include",
    "# the page URL and your browser.",
    "",
    `Contact: ${REPO}/security/advisories/new`,
    `Contact: ${REPO}/issues/new`,
    `Expires: ${EXPIRES}`,
    `Policy: ${REPO}/blob/main/SECURITY.md`,
    `Canonical: ${origin}/.well-known/security.txt`,
    "Preferred-Languages: en",
    "",
  ].join("\n");
}

export function GET(request: Request) {
  return new Response(securityTxt(new URL(request.url).origin), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
