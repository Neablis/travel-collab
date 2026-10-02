// **The front door: `GET /api/v1`.** A caller who knows only the base URL can
// find the reference from here, rather than guessing a path — an external agent
// tried `/.well-known/agent.json` first. `/.well-known/api-catalog` (RFC 9727)
// says the same thing in a standard shape for a crawler.
//
// **Not declared through `route()`, for the same reason `openapi/route.ts` is
// not**: it needs no token, no scope and no rate limit, because it is the same
// bytes for everybody. `conformance.test.ts` names this file in its exemption
// list, and the OpenAPI generator skips it because it carries no declaration.
//
// `docs` is the same document drawn for a person, and the onboarding path
// beside it — the `service-doc` the api-catalog names. Paths stay relative
// here, as `openapi` always has: this index is the same bytes for every host.
const INDEX = {
  name: "Caesura API",
  version: "v1",
  openapi: "/api/v1/openapi",
  docs: "/developers/reference",
  auth: "Authorization: Bearer <token>; mint one in Account → Profile → API tokens (Premium plan). How to get there: /developers.",
} as const;

/** The index, identical for every caller. */
export function GET() {
  return Response.json(INDEX, { headers: { "cache-control": "public, max-age=3600" } });
}
