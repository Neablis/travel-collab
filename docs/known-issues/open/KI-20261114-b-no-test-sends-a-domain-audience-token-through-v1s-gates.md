### KI-2026-11-14-b — no test sends a domain-audience Poppy token through v1's scope, 402 and trip gates

- **Severity:** reliability (test gap; no known defect). The v1 gates are shared code, so they very
  likely work for an OAuth token, but that is an inference.
- **Area:** `apps/web/src/server/public-api/oauthActor.int.test.ts` (where the audience clauses are
  tested), `apps/web/src/server/public-api/route.int.test.ts`, `apps/web/src/server/public-api/route.ts`
  (`route()`), `apps/web/src/app/api/mcp/route.int.test.ts` (where the gates are exercised for an
  `/api/mcp`-audience token only).
- **Symptom / What happens:** M60's gate box "The v1 API takes a Poppy access token with every gate
  `route()` already applies" was closed by deferral on 2026-11-14, not passed. The audience clauses
  are tested in `oauthActor.int.test.ts` ("is accepted on v1 when the grant was made for the
  domain, and refused inside an MCP dispatch"; "is refused on v1 when the grant was made for
  /api/mcp, and accepted inside the dispatch"; "is 401 on a bare /v1/account call"). The gates (the
  scope check, 402 on a lapsed plan, the owner's trip reach) are asserted there only for a token
  made for `/api/mcp` running inside an MCP dispatch. No test sends a domain-audience token to a v1
  route and checks that a missing scope is refused, that a lapsed plan answers 402, and that a trip
  the grant's owner cannot reach is refused.
- **Why not fixed here:** found at the M60 gate close, which is prose-only on part 0 and adds no
  test.
- **Fix path:** one integration test in `apps/web/src/server/public-api/oauthActor.int.test.ts`:
  a token made for the domain audience, sent to a v1 route, expecting 403 for a scope it lacks,
  402 on a lapsed plan, and the trip refusal for a trip outside the owner's reach, each seen
  failing first (weaken the gate for OAuth actors, watch the case go red, restore it). Then tick the
  box's replacement note in M60's file and move this entry to `resolved/`.
- **Cross-reference:** M60 exit gate (amended out at the close); ADR-089; KI-2026-11-14-a.
- **First noted:** 2026-11-14, M60 gate close.
