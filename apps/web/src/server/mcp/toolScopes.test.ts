import { describe, expect, it } from "vitest";
import { DECLARED, type DeclaredHandler } from "@/server/public-api/route";
import type { McpTool } from "./tools";
import { mcpToolScopes } from "./toolScopes";

/** A handler that declares `scope` the way `route()` does, with nothing behind it. */
function declaring(scope: string, orScope?: string): DeclaredHandler {
  const handler = (async () => new Response()) as unknown as DeclaredHandler;
  Object.defineProperty(handler, DECLARED, { value: { scope, orScope } });
  return handler;
}

const fixture = (name: string, description: string, handler: DeclaredHandler): McpTool => ({
  name,
  title: name,
  description,
  handler,
  path: "/api/v1/fixture",
  annotations: { readOnlyHint: true, openWorldHint: false },
});

describe("mcpToolScopes", () => {
  it("takes each tool's scope from its handler's declaration, so a new tool appears with no second list to edit", () => {
    const rows = mcpToolScopes([
      fixture("fixture_read", "Reads a fixture. Then a second sentence a table does not need.", declaring("trips:read")),
      fixture("fixture_share", "Shares a fixture.", declaring("sharing:write", "trips:write")),
    ]);
    expect(rows).toEqual([
      { name: "fixture_read", description: "Reads a fixture.", scope: "trips:read" },
      { name: "fixture_share", description: "Shares a fixture.", scope: "sharing:write", orScope: "trips:write" },
    ]);
  });
});
