import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
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

/** What `tools/list` answers: each tool, its route's schema, and the scope it needs. */
export function listedTools(tools: readonly McpTool[]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: `${tool.description}\n\nNeeds the "${tool.handler[DECLARED].scope}" scope.`,
    inputSchema: inputSchemaFor(tool),
    annotations: { title: tool.title, ...tool.annotations },
  }));
}

/**
 * The server for one request, whose calls spend `caller`'s bearer. `tools` is
 * passed in because the table imports v1 routes, which this folder may not.
 */
export function buildServer(tools: readonly McpTool[], caller: McpCaller): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: { listChanged: false } } });
  const listed = listedTools(tools);
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listed }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const tool = tools.find((t) => t.name === params.name);
    if (tool === undefined) {
      return { content: [{ type: "text", text: `No tool is called "${params.name}".` }], isError: true };
    }
    return callTool(tool, params.arguments ?? {}, caller);
  });
  return server;
}
