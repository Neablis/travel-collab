import { API_SCOPES, API_TOKEN_PREFIX, SCOPE_CATALOGUE } from "@tc/contracts";
import { TOOLS } from "./tools";
import { mcpToolScopes } from "@/server/mcp/toolScopes";
import { API_TOKEN_QUOTA } from "@/server/public-api/route";
import { placeSearchTokenQuota } from "@/server/quota";

// **The body of `GET /agents.md` — the instructions for an agent that acts on Caesura for a
// person** (M63 D2). `/llms.txt` says what Caesura is; this says how to behave
// on it: how to sign in, which surface fits which job, what each scope allows,
// the limits, and what never to do without asking.
//
// **Everything numeric or listed is read from the code that enforces it**: the
// scopes from `SCOPE_CATALOGUE`, the hourly limit from `API_TOKEN_QUOTA`, the
// place-search allowance from `placeSearchTokenQuota()`, the tool table from
// `mcpToolScopes()`. A hand-typed copy would disagree within a release.
//
// **Written for the agent's reader, not for Caesura's builders:** no word on how
// the site is built or hosted (`discovery.test.ts` holds it to a deny-list).
//
// It sits beside the MCP tool list, not in the route at `app/agents.md/`, because
// it imports `server/**`, which only `app/api/**` may (the lint wall); the route
// is a thin wrapper over it.

/** The agents.md document for `origin`, links absolute. */
export function agentsMd(origin: string): string {
  const at = (path: string) => `${origin}${path}`;
  const hourly = API_TOKEN_QUOTA.perUser;
  const placeSearchDaily = placeSearchTokenQuota()[0]!.perUser;
  const scopes = API_SCOPES.map((scope) => `- \`${scope}\` — ${SCOPE_CATALOGUE[scope].title}. ${SCOPE_CATALOGUE[scope].description}`);
  const tools = mcpToolScopes(TOOLS).map(
    (tool) =>
      `| \`${tool.name}\` | ${tool.description} | \`${tool.scope}\`${tool.orScope === undefined ? "" : ` or \`${tool.orScope}\``} |`,
  );
  return [
    "# Caesura for agents",
    "",
    "> How to act on Caesura, a collaborative trip planner, for the person who sent you.",
    "",
    "You act as that person and can do no more than they can. Everything below is about doing it well and " +
      "without surprises.",
    "",
    "## Signing in",
    "",
    "Pick the way that fits how you were given access.",
    "",
    `- **A scoped token.** A person mints it in Account → Security → API tokens → New token (Premium) and gives you the secret, which is shown once. Send it as \`Authorization: Bearer ${API_TOKEN_PREFIX}...\` on every request. It holds only the scopes it was given.`,
    `- **OAuth through the MCP server.** Connect an MCP client to \`${at("/api/mcp")}\`; it signs the person in with OAuth 2.1 and shows them what you may do. Discovery is at \`/.well-known/oauth-protected-resource/api/mcp\`.`,
    `- **Poppy.** If you carry a Personal Agent Session, start from \`${at("/.well-known/poppy.json")}\`.`,
    "",
    "## Which surface fits which job",
    "",
    `- **MCP tools** (\`${at("/api/mcp")}\`): the best fit when you are an assistant in a chat: a short list of tools, each already described for a model.`,
    `- **The REST API** (\`${at("/api/v1")}\`): the best fit for a script or a program. Every endpoint, its scope, request and response is in the [OpenAPI document](${at("/api/v1/openapi")}); [the reference](${at("/developers/reference")}) renders it for a person.`,
    `- **The API catalog** (\`${at("/.well-known/api-catalog")}\`): where to start when you were handed only the host.`,
    `- **\`${at("/llms.txt")}\`**: what Caesura is, in a page.`,
    "",
    "## Scopes",
    "",
    "Ask for the narrowest set that does the task.",
    "",
    ...scopes,
    "",
    "## Limits",
    "",
    `- ${hourly} requests per hour for each token or OAuth connection (an OAuth connection keeps one allowance across its refreshed access tokens). Past it you get HTTP 429 with a \`Retry-After\` header: wait that many seconds.`,
    "- A Poppy session that is not signed in has its own, separate read limits; the same 429 and `Retry-After` apply.",
    `- ${placeSearchDaily} place searches per day for each token or OAuth connection (\`search_places\`, \`GET /api/v1/geocode\`). Search once per place.`,
    "- Some writes that create something accept an `Idempotency-Key` header, so a retry after a timeout does not make a second one.",
    "",
    "## MCP tools",
    "",
    "| Tool | What it does | Scope |",
    "|---|---|---|",
    ...tools,
    "",
    "## What never to do",
    "",
    "- **Never publish, delete or invite without asking the person first.** Say what you are about to do, to what, and wait for a yes. Publishing puts a Playbook in front of everyone; an invite or a share link puts a trip in front of someone else.",
    "- **Never ask for more scope than the task needs.** If a read is enough, do not request the write scope.",
    "- **Never overwrite what you have not read.** Before changing a Playbook, read it and send the version you read back as `expectedVersion`; if it is refused as stale, read again rather than forcing it. A notebook page has no version check, so read it first and send only the fields you mean to change.",
    "- **Never retry in a loop.** On a 429, wait for `Retry-After`; on a 4xx, change the request.",
    "- **Never store or repeat the person's token.** Do not put it in a trip, a Playbook or a message.",
    "",
  ].join("\n");
}
