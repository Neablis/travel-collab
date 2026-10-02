import { API_SCOPES, API_TOKEN_PREFIX, SCOPE_CATALOGUE } from "@tc/contracts";
import { SITE_DESCRIPTION } from "@/lib/siteMetadata";

// **`GET /llms.txt` — the front page, for a reader that is a model.**
// llmstxt.org's shape: an H1, a one-line blockquote, a little prose, then
// sections of markdown links. An agent handed only the host reads this first,
// so it has to say what Caesura is, who it is for, where the API is described
// and how a person gets a token — the four questions an agent asked of the
// API before this file existed, and had to answer by guessing paths.
//
// **The scopes are `SCOPE_CATALOGUE`, not a copy of it.** That is the record
// `openapi.ts` publishes in `info.description` and the token form renders, so
// a new scope reaches this file in the same diff that adds it. It lives in
// `@tc/contracts`, which matters here: this route sits outside `src/app/api/**`
// and `src/app/.well-known/**`, so the lint wall treats it as UI and it may
// not import `src/server`.
//
// **Absolute URLs, from the request's own origin** — the same construction as
// `.well-known/api-catalog/route.ts`, so a preview deploy points at itself and
// not at production.
//
// **Reachability is not this file's to decide.** The Vercel firewall
// challenges bots outside `/api/*`, so this path needs the same dashboard
// exemption as the api-catalog — see `docs/guidelines/using-the-api.md`.
//
// `discovery.test.ts` follows every link below to a route or page that exists.

/** The llms.txt document for `origin`, links absolute. */
function llmsTxt(origin: string): string {
  const at = (path: string) => `${origin}${path}`;
  const scopes = API_SCOPES.map(
    (scope) => `- [${scope}](${at("/developers#scopes")}): ${SCOPE_CATALOGUE[scope].description}`,
  );
  return [
    "# Caesura",
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "Caesura is collaborative trip planning for a group going somewhere together: one shared trip " +
      "of days and stops, with costs, a notebook and the whole change history, and playbooks — days " +
      "worth repeating, saved by the people who lived them — to borrow from. Signup is invite-only " +
      "while it is small.",
    "",
    "It has a public REST API under `/api/v1`. A token acts as the person who minted it, holds only " +
      "the scopes it was given, and can never do more than that person can. Send it on every request " +
      `as \`Authorization: Bearer ${API_TOKEN_PREFIX}...\`. Tokens are on the Premium plan; a person mints one in ` +
      "Account → Profile → API tokens → New token, and the secret is shown once.",
    "",
    "## API",
    "",
    `- [API catalog](${at("/.well-known/api-catalog")}): RFC 9727 linkset; its \`service-desc\` is the OpenAPI document. No token`,
    `- [OpenAPI document](${at("/api/v1/openapi")}): OpenAPI 3.0, generated from the route declarations — every endpoint, its scope, request and response. Paths are relative to \`/api\`. No token`,
    `- [API index](${at("/api/v1")}): a small JSON pointer to the OpenAPI document and how to authenticate. No token`,
    `- [API reference](${at("/developers/reference")}): the OpenAPI document rendered for a person to read`,
    "",
    "## Getting a token",
    "",
    `- [Developers](${at("/developers")}): how a person gets in (an invite code or a trip invite link), signs in, and mints a token — scopes, lifetime, and where the secret is shown`,
    "",
    "## Scopes",
    "",
    ...scopes,
    "",
    "## Optional",
    "",
    `- [Caesura](${at("/welcome")}): the landing page`,
    `- [An example trip](${at("/demo")}): a real trip board, read-only, no account needed`,
    "",
  ].join("\n");
}

/** Serve llms.txt as plain text, every link absolute against the request's origin. */
export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(llmsTxt(origin), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
