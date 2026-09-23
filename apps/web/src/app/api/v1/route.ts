// **The front door: `GET /api/v1`.** A caller who knows only the base URL can
// find the reference from here, rather than guessing a path — an external agent
// tried `/.well-known/agent.json` first. `/.well-known/api-catalog` (RFC 9727)
// says the same thing in a standard shape for a crawler.
//
// **Not declared through `route()`, for the same reason `openapi/route.ts` is
// not**: it needs no token, no scope and no rate limit, because it is the same
// bytes for everybody. `conformance.test.ts` names this file in its exemption
// list, and the OpenAPI generator skips it because it carries no declaration.
const INDEX = {
  name: "Caesura API",
  version: "v1",
  openapi: "/api/v1/openapi",
  auth: "Authorization: Bearer <token>; mint one in Account settings → API tokens.",
} as const;

export function GET() {
  return Response.json(INDEX, { headers: { "cache-control": "public, max-age=3600" } });
}
