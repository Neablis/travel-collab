import {
  MissingRequiredClientCapabilityError,
  Server,
  type Tool,
  UnsupportedProtocolVersionError,
} from "@modelcontextprotocol/server";
import { DECLARED } from "@/server/public-api/route";
import { callTool, type McpCaller } from "./dispatch";
import { inputSchemaFor } from "./schemas";
import type { McpTool } from "./tools";

// **One MCP server per request, for one caller** (ADR-083 §8). Stateless:
// nothing outlives the request, so any function instance can answer the next.
//
// The SDK's low-level `Server` rather than `McpServer`: `McpServer` builds each
// input schema from Zod itself, and ours must be the route's own, through
// `inputSchemaFor`, which `conformance.test.ts` compares against the route.

export const SERVER_INFO = { name: "caesura", title: "Caesura", version: "1.0.0" } as const;

// 2026-07-28 lets a client cache `tools/list`. The list is the same for every
// caller today, but it answers a bearer, so it stays `private`: a shared cache
// gains nothing over the client's own, and a list later filtered by grant stays
// correct. A minute bounds how long a deploy that changes the table goes
// unseen, since `listChanged` is false and nothing else would say so.
const TOOLS_LIST_CACHE = { ttlMs: 60_000, cacheScope: "private" } as const;

/** What `tools/list` answers: each tool, its route's schema, and the scope it needs. */
export function listedTools(tools: readonly McpTool[]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: `${tool.description}\n\nNeeds the "${tool.handler[DECLARED].scope}" scope.`,
    // Built from the route's JSON Schema, so JSON all the way down; `schemas.ts`
    // only types its properties as `object`, which SDK v2 will not take as JSON.
    inputSchema: inputSchemaFor(tool) as Tool["inputSchema"],
    annotations: { title: tool.title, ...tool.annotations },
  }));
}

/**
 * The server for one request, whose calls spend `caller`'s bearer. `tools` is
 * passed in because the table imports v1 routes, which this folder may not.
 */
export function buildServer(tools: readonly McpTool[], caller: McpCaller): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: { listChanged: false } },
    cacheHints: { "tools/list": TOOLS_LIST_CACHE },
  });
  // The 2025 transport's own refusals, such as a 406, and a failed send or
  // encode arrive here, not at the handler's `onerror`.
  server.onerror = reportMcpError;
  const listed = listedTools(tools);
  server.setRequestHandler("tools/list", () => ({ tools: listed }));
  server.setRequestHandler("tools/call", async ({ params }) => {
    const tool = tools.find((t) => t.name === params.name);
    if (tool === undefined) {
      return { content: [{ type: "text", text: `No tool is called "${params.name}".` }], isError: true };
    }
    return callTool(tool, params.arguments ?? {}, caller);
  });
  return server;
}

/**
 * Log what the SDK reports. Reporting only: it has already answered the client
 * in-band. A misbehaving connector should not fill the error log with lines
 * that read as server faults, so a client's mistake is a warning.
 */
export function reportMcpError(error: Error): void {
  if (clientMistake(error)) console.warn("mcp request rejected", { error });
  else console.error("mcp handler error", { error });
}

/**
 * Whether the SDK refused the request for the client's own fault: a 406 or
 * 415, an unsupported revision, a missing capability, a header the body
 * contradicts, or a full listen table.
 */
function clientMistake(error: Error): boolean {
  return (
    error instanceof UnsupportedProtocolVersionError ||
    error instanceof MissingRequiredClientCapabilityError ||
    /^(Rejected |Not Acceptable|Unsupported Media Type|subscriptions\/listen refused)/.test(error.message)
  );
}
