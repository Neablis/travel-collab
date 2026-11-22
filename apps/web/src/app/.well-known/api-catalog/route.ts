// **RFC 9727 API catalog: `GET /.well-known/api-catalog`.** The standard place a
// crawler or agent looks to find what APIs a host publishes. One linkset, one
// item: its `service-desc` is the OpenAPI document (for a program) and its
// `service-doc` is `/developers/reference` (for a person) — the two RFC 8631
// relations RFC 9727 names for exactly this.
//
// **Reachability is not this file's to decide.** Any bot protection put in
// front of the deployment (none since M59: Cloudflare is DNS-only) must exempt
// this path before a bot can read it — see `docs/guidelines/using-the-api.md`.
//
// A plain static handler: no auth, no server imports. It sits under the
// `.well-known/**/route.ts` lint-wall exemption only because every route here
// does, not because it needs one.
//
// **Absolute URLs, from the deployment's configured origin** (`deploymentOrigin()`),
// as `/llms.txt` does: the request's own origin is the container's bind address
// in production (`https://0.0.0.0:3000`), which is what every href here carried
// until this fix.
import { deploymentOrigin } from "@/lib/deploymentOrigin";

/** The catalog linkset, every href absolute against the deployment's configured origin. The request is received and ignored: deriving the origin from it is the bind-address bug. */
export function GET(_request?: Request) {
  const origin = deploymentOrigin();
  const linkset = {
    linkset: [
      {
        anchor: `${origin}/api/v1`,
        "service-desc": [{ href: `${origin}/api/v1/openapi`, type: "application/json" }],
        "service-doc": [{ href: `${origin}/developers/reference`, type: "text/html" }],
        // the IANA `describedby` relation: how an agent should behave on this API, beside what it is.
        describedby: [{ href: `${origin}/agents.md`, type: "text/markdown" }],
      },
    ],
  };
  return new Response(JSON.stringify(linkset), {
    headers: {
      "content-type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      "cache-control": "public, max-age=3600",
    },
  });
}
