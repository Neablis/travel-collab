import type { ApiScope } from "@tc/contracts";
import { DECLARED } from "@/server/public-api/route";
import type { McpTool } from "./tools";

// **The MCP tool table: name, what it does, the scope it needs.** A tool owns
// no scope; its v1 handler declares one (`route()`), so the table is a join and
// a tool added to `app/api/mcp/tools.ts` shows up here with the scope its
// handler already carries. `/agents.md` and the developers page both render
// this, so neither can drift from what a token with that scope may do.
//
// The tool list is passed in: it lives under `app/**`, which `server/**` never
// imports (`pnpm arch`).

export interface McpToolScope {
  readonly name: string;
  /** The first sentence of the tool's own description: enough for a table row. */
  readonly description: string;
  readonly scope: ApiScope;
  /** A second scope that is enough on its own, when the handler declares one. */
  readonly orScope?: ApiScope;
}

/** One row per tool, in the order `tools` lists them. */
export function mcpToolScopes(tools: readonly McpTool[]): McpToolScope[] {
  return tools.map((tool) => {
    const { scope, orScope } = tool.handler[DECLARED];
    const [first = tool.description] = tool.description.split(/(?<=\.)\s/);
    return { name: tool.name, description: first, scope, ...(orScope === undefined ? {} : { orScope }) };
  });
}
