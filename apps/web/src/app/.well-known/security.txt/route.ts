// **RFC 9116 `GET /.well-known/security.txt`.** Where a researcher or a
// scanner looks to find out how to report a vulnerability. It says what
// `/security` says, in the format they expect: the contacts are `SECURITY_CONTACTS`
// (the security email), the same list the page shows.
//
// **`Expires` is a fixed date, on purpose.** RFC 9116 makes it required and
// recommends under a year out, so a file whose contacts went stale stops being
// trusted. Computing it per request would defeat that. Refresh the date when
// you re-read the contacts below.
//
// **`Canonical` comes from the deployment's configured origin**
// (`deploymentOrigin()`), the same construction as `api-catalog/route.ts`.
// The request's own origin is the container's bind address in production
// (`https://0.0.0.0:3000`). A preview names itself when its `PUBLIC_ORIGIN`
// names it; a preview that inherits production's points at production, as the
// canonical URLs do; without one it falls back to localhost, which the build
// check warns about rather than failing.
//
// A plain static handler: no auth, no server imports. It sits under the
// `.well-known/**/route.ts` lint-wall exemption only because every route here
// does. Reachability for bots is the firewall's call, as for the api-catalog —
// see `docs/guidelines/using-the-api.md`.
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { SECURITY_CONTACTS, SECURITY_POLICY_URL } from "@/lib/securityContacts";

/** When the contacts below were last confirmed, plus under a year. */
const EXPIRES = "2027-10-01T00:00:00.000Z";

/** The security.txt document for `origin`. */
function securityTxt(origin: string): string {
  return [
    "# Caesura (travel-collab) security contact.",
    "#",
    "# Found something exploitable? Report it privately to the Contact below.",
    "# Do not open a public issue for it.",
    "",
    ...SECURITY_CONTACTS.map((contact) => `Contact: ${contact.href}`),
    `Expires: ${EXPIRES}`,
    `Policy: ${SECURITY_POLICY_URL}`,
    `Canonical: ${origin}/.well-known/security.txt`,
    "Preferred-Languages: en",
    "",
  ].join("\n");
}

/** The security.txt document as plain text, its Canonical naming the deployment's configured origin. The request is received and ignored: deriving the origin from it is the bind-address bug. */
export function GET(_request?: Request) {
  return new Response(securityTxt(deploymentOrigin()), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
