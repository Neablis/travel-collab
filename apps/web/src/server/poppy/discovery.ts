import { API_SCOPES, SCOPE_CATALOGUE, SCOPE_HINTS } from "@tc/contracts";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { mcpResource, oauthIssuer } from "@/server/oauth/metadata";

// **`/.well-known/poppy.json`** (Personal Agent Protocol 1.0, spec 3;
// ADR-089 decisions 1, 2 and 9). What a Personal Agent reads before it will talk
// to us: who we are, what each scope means, and where the APIs are.
//
// **Every URL and the domain come from `deploymentOrigin()`, never the request**
// (ADR-083 amendment B): the spec has the agent check `organization.domain`
// against the host that served the document, and a `Host` we echoed would make
// that check pass for anyone. No `agent` (the assistant is not offered as a
// Poppy conversation).
//
// **There is no session endpoint, and none is missing** (Poppy 1.0 §5): a
// Session starts with the first request whose `Poppy-Session` header carries a
// new `sid`, and is verified on every request (`server/poppy/sessions.ts`).
// Signed out, that header alone reads Discover; signed in, an OAuth access token
// rides beside it as a plain `Bearer` (§7). `web: {}` is §3.1's signed-out
// website: no `browser_session_endpoint`, so agents browse as any visitor.

/**
 * The pinned protocol version. An agent uses this document when the
 * document's version is the one it speaks, or is listed in
 * `supported_versions` (Poppy 1.0 §3.4): 1.0 is pinned, and 0.4 stays
 * served because the Muse connector speaks only 0.3/0.4 (ADR-089
 * decision 1, as amended 2026-11-14). A server must send only what the
 * version the client asked for defines.
 */
export const POPPY_PROTOCOL_VERSION = "1.0";

/**
 * The older versions still served, as Poppy 1.0 §3.4 defines them: a map from
 * version to that version's document, as a path on this deployment.
 * `poppyDocument()` prepends the configured origin, so the served value is an
 * absolute HTTPS URL on the host that served poppy.json — a list is not
 * enough: the official 1.0 kit validator's `discovery.schema` fails
 * `/supported_versions must be an object, not an array`, and
 * `discovery.supported-versions` then fetches each linked document and
 * requires it to serve that protocol_version with no `supported_versions`
 * of its own. The values are paths, not full URLs, so a preview names
 * itself (the origin comes from configuration, never the request).
 */
export const POPPY_SUPPORTED_VERSIONS: Readonly<Record<string, string>> = {
  "0.4": "/.well-known/poppy-0.4.json",
};

/** The `poppy.json` body for this deployment's origin. */
export function poppyDocument() {
  return buildPoppyDocument(POPPY_PROTOCOL_VERSION);
}

/**
 * The 0.4 document `supported_versions` links to: the same body, pinned at
 * 0.4, with no `supported_versions` of its own (§3.4: a linked document is
 * exactly one version's document). Same domain and issuer as the 1.0
 * document, so `discovery.versions-same-company` holds.
 */
export function poppyDocument04() {
  return buildPoppyDocument("0.4");
}

/** One body for both versions; only the pinned document lists the others. */
function buildPoppyDocument(protocolVersion: string) {
  const origin = deploymentOrigin();
  return {
    protocol_version: protocolVersion,
    // §3.4: the pinned document maps each older version to its document URL.
    // A linked document carries none — it is exactly one version's document.
    ...(protocolVersion === POPPY_PROTOCOL_VERSION
      ? {
          supported_versions: Object.fromEntries(
            Object.entries(POPPY_SUPPORTED_VERSIONS).map(([version, path]) => [
              version,
              `${origin}${path}`,
            ]),
          ),
        }
      : {}),
    organization: { name: "Caesura", domain: new URL(origin).host },
    auth: {
      // Optional in 1.0 with one authorization server, and when present it MUST
      // name that server (§3.1): the protected resource metadata's only
      // `authorization_servers` entry, which is `oauthIssuer()` too. Naming it
      // lets an agent check the issuer before fetching that metadata. It does
      // not make the document usable by a 0.2 agent: an agent must not use a
      // document whose `major.minor` it does not implement, unless that version
      // is listed in `supported_versions` (§3.4).
      issuer: oauthIssuer(),
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
