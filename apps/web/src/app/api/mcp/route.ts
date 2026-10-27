import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpCaller } from "@/server/mcp/dispatch";
import { buildServer } from "@/server/mcp/server";
import { runInMcpDispatch } from "@/server/oauth/dispatchContext";
import { resolveActor } from "@/server/public-api/actor";
import { oauthChallenge, oauthRefusalResponse } from "@/server/public-api/route";

// **The MCP connector: `POST /api/mcp`** (ADR-083 §8). Streamable HTTP,
// stateless, JSON responses: no `Mcp-Session-Id` and no stream to resume,
// because a Vercel function has no sticky routing to come back to.
//
// **The credential is resolved before any MCP is parsed.** A client with no
// token, or a dead one, gets the 401 whose `resource_metadata` starts the OAuth
// flow, rather than a JSON-RPC error it would not know to refresh on. Only an
// OAuth access token is taken here: a session cookie would let any page the
// person visits call tools as them, and a `tc_` token belongs to `/api/v1`.

/** One JSON-RPC exchange with the connector, as the OAuth token's holder, or the refusal of that token. */
export async function POST(request: Request): Promise<Response> {
  const header = request.headers.get("authorization");
  if (header === null) {
    return Response.json(
      { error: { code: "unauthenticated", message: "Connect with OAuth to use this server." } },
      { status: 401, headers: oauthChallenge(false) },
    );
  }
  let resolution: Awaited<ReturnType<typeof resolveActor>>;
  try {
    resolution = await runInMcpDispatch(() => resolveActor(request));
  } catch (error) {
    console.error("mcp credential resolution threw", { error });
    return Response.json(
      { error: { code: "server-error", message: "Something went wrong. The failure has been logged." } },
      { status: 500 },
    );
  }
  if (!resolution.ok && resolution.refusal.reason === "oauth") return oauthRefusalResponse(resolution.refusal.refusal);
  if (!resolution.ok || resolution.actor.via !== "oauth") return oauthRefusalResponse({ reason: "unknown" });

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const caller: McpCaller = { request, userId: resolution.actor.userId, grantId: resolution.actor.grantId };
  const server = buildServer(caller);
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request);
    // The bearer lapsed between the check above and a tool's own: the same
    // HTTP refusal, so the client refreshes rather than the model giving up.
    return caller.refusal ?? response;
  } finally {
    await server.close();
  }
}

/** No stream to open and no session to end, so neither method exists here. */
function notAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export const GET = notAllowed;
export const DELETE = notAllowed;
