import { API_SCOPES, SCOPE_CATALOGUE, SCOPE_HINTS } from "@tc/contracts";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { mcpResource } from "@/server/oauth/metadata";

// **`/.well-known/poppy.json`** (Personal Agent Protocol draft 0.4, spec 3;
// ADR-089 decisions 1, 2 and 9). What a Personal Agent reads before it will talk
// to us: who we are, what each scope means, and where the APIs are.
//
// **Every URL and the domain come from `deploymentOrigin()`, never the request**
// (ADR-083 amendment B): the spec has the agent check `organization.domain`
// against the host that served the document, and a `Host` we echoed would make
// that check pass for anyone. No `agent` (the assistant is not offered as a
// Poppy conversation).
//
// **There is no session endpoint, and none is missing** (Poppy 0.4 §5): a
// Session starts with the first request whose `Poppy-Session` header carries a
// new `sid`, and is verified on every request (`server/poppy/sessions.ts`).
// Signed out, that header alone reads Discover; signed in, an OAuth access token
// rides beside it as a plain `Bearer` (§7). `web: {}` is §3.1's signed-out
// website: no `browser_session_endpoint`, so agents browse as any visitor.

/** The pinned protocol version; no `supported_versions` (ADR-089 decision 1). */
export const POPPY_PROTOCOL_VERSION = "0.4";

/** The `poppy.json` body for this deployment's origin. */
export function poppyDocument() {
  const origin = deploymentOrigin();
  return {
    protocol_version: POPPY_PROTOCOL_VERSION,
    organization: { name: "Caesura", domain: new URL(origin).host },
    auth: {
      // `auth.scopes` takes the catalogue's sentences, so the consent screen,
      // openapi and this document cannot describe a scope differently.
      // `offline_access` is in `scopes_supported` too, so it needs a sentence of its own.
      scopes: {
        ...Object.fromEntries(API_SCOPES.map((scope) => [scope, SCOPE_CATALOGUE[scope].description])),
        offline_access: "Stay connected: a refresh token, which every grant gets anyway",
      },
      scope_hints: SCOPE_HINTS,
    },
    apis: [
      { type: "mcp", url: mcpResource(), description: "Trips, the Notebook and your library, as tools" },
      { type: "openapi", url: `${origin}/api/v1/openapi`, description: "The same capabilities as a REST API" },
    ],
    // Excluded tasks, and where to send feedback (spec 9).
    tasks: { endpoint: `${origin}/api/poppy/tasks` },
    // Agents browse the public site as signed-out visitors: no browser sign-in.
    web: {},
  };
}
