import type { DeclaredHandler } from "@/server/public-api/route";

// **What one MCP tool is: a row naming the v1 handler it adapts** (ADR-083 §8,
// M55 D2). The rows are `app/api/mcp/tools.ts`, which imports v1 route modules
// that this folder may not.

export interface McpTool {
  readonly name: string;
  readonly title: string;
  /** Written for a model choosing a tool, not for a person reading a reference. */
  readonly description: string;
  readonly handler: DeclaredHandler;
  /** The v1 path; each `{name}` is a path parameter the tool takes as a string. */
  readonly path: string;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    /** MCP reads an unset value as `true` on a tool that writes, so every writer says. */
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint: boolean;
  };
  /** The body fields this tool offers, when it offers only some of the route's. */
  readonly offers?: readonly string[];
  /** Body fields the tool sets itself, never taken from the input. */
  readonly fixed?: Readonly<Record<string, unknown>>;
  /** Adds to a successful answer what the v1 response lacks. */
  readonly answer?: (body: unknown) => unknown;
}

/** The path parameters a tool's v1 path names, in order. */
export function pathParams(tool: McpTool): string[] {
  return [...tool.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
}
