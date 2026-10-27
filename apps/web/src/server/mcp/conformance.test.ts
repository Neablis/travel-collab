// **Every tool is a v1 route under another name, and nothing more** (M55 D2,
// ADR-083 §8). A tool whose handler did not come through `route()` would skip
// the scope check, the error envelope and the rate limit; a schema that is not
// the route's would tell a model to send what the route refuses. Both are
// checked here against the declaration itself, read off the handler.
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { DECLARED, type DeclaredHandler } from "@/server/public-api/route";
import { inputSchemaFor, PAGING } from "./schemas";
import { listedTools } from "./server";
import { pathParams, TOOLS, type McpTool } from "./tools";

// The tools import v1 route modules, which reach `next-auth`; nothing here calls it.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

/** Why this tool is not a faithful adapter of a declared v1 handler, if it is not. */
function declarationProblems(tool: McpTool): string[] {
  const declared = (tool.handler as Partial<DeclaredHandler>)[DECLARED];
  if (declared === undefined) return [`${tool.name}: its handler did not come through route()`];
  const problems: string[] = [];
  if (declared.method === "DELETE") problems.push(`${tool.name}: a connector deletes nothing (D4)`);
  if (tool.annotations.readOnlyHint !== (declared.method === "GET")) {
    problems.push(`${tool.name}: readOnlyHint says ${tool.annotations.readOnlyHint}, the route is ${declared.method}`);
  }
  if (!tool.annotations.readOnlyHint && tool.annotations.destructiveHint === undefined) {
    problems.push(`${tool.name}: a writer must say destructiveHint, which MCP otherwise reads as true`);
  }
  return problems;
}

/**
 * Where the served schema differs from the route's own: every property it
 * offers is the route's, a path parameter, or the wrapper's paging; and it
 * requires what the route requires, less what the tool fixes or does not offer.
 */
function schemaProblems(tool: McpTool, served: Record<string, unknown>): string[] {
  const def = tool.handler[DECLARED].def;
  const source = def.body ?? def.query;
  const route = (source === undefined ? {} : z.toJSONSchema(source, { target: "draft-2020-12", io: "input" })) as {
    properties?: Record<string, unknown>;
    required?: string[];
    anyOf?: unknown;
  };
  if (route.anyOf !== undefined) {
    return JSON.stringify(served.anyOf) === JSON.stringify(route.anyOf) ? [] : [`${tool.name}: its branches differ from the route's`];
  }
  const problems: string[] = [];
  const params = pathParams(tool);
  const properties = (served.properties ?? {}) as Record<string, unknown>;
  for (const [name, schema] of Object.entries(properties)) {
    if (params.includes(name)) continue;
    if (tool.handler[DECLARED].kind === "collection" && name in PAGING) continue;
    if (!(name in (route.properties ?? {}))) problems.push(`${tool.name}.${name}: the route takes no such field`);
    else if (JSON.stringify(schema) !== JSON.stringify(route.properties![name])) {
      problems.push(`${tool.name}.${name}: differs from the route's schema`);
    }
  }
  const takes = (name: string) => name in properties;
  const missing = (route.required ?? []).filter((name) => !takes(name) && !(tool.fixed !== undefined && name in tool.fixed));
  if (missing.length > 0) problems.push(`${tool.name}: the route requires ${missing.join(", ")}, which it neither takes nor fixes`);
  const required = (served.required ?? []) as string[];
  const expected = [...params, ...(route.required ?? []).filter(takes)];
  if (JSON.stringify([...required].sort()) !== JSON.stringify([...expected].sort())) {
    problems.push(`${tool.name}: requires [${required.join(", ")}], the route [${expected.join(", ")}]`);
  }
  return problems;
}

describe("the MCP tools", () => {
  it("are the tools D4 names, once each, and nothing that deletes", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(
      [
        "whoami",
        "search_places",
        "search_library_cities",
        "list_discover_playbooks",
        "list_my_playbooks",
        "get_playbook",
        "create_playbook",
        "update_playbook",
        "publish_playbook",
        "unpublish_playbook",
        "list_trips",
        "get_trip",
        "list_notebook_pages",
        "get_notebook_page",
        "update_notebook_page",
      ].sort(),
    );
  });

  it("each adapt a handler declared through route(), with hints that match its method", () => {
    expect(TOOLS.flatMap(declarationProblems)).toEqual([]);
  });

  it("refuse a tool whose handler has no declaration", () => {
    const bare = Object.assign(async () => new Response(null), {}) as unknown as DeclaredHandler;
    expect(declarationProblems({ ...TOOLS[0]!, handler: bare })).toEqual([
      "whoami: its handler did not come through route()",
    ]);
  });

  it("serve each route's own schema, from tools/list", () => {
    const served = new Map(listedTools().map((t) => [t.name, t.inputSchema as Record<string, unknown>]));
    expect(TOOLS.flatMap((tool) => schemaProblems(tool, served.get(tool.name)!))).toEqual([]);
  });

  it("refuse a schema that differs from its route's", () => {
    const update = TOOLS.find((t) => t.name === "update_playbook")!;
    const schema = inputSchemaFor(update);
    const drifted = { ...schema, properties: { ...schema.properties, name: { type: "string" } } };
    expect(schemaProblems(update, drifted)).toEqual(["update_playbook.name: differs from the route's schema"]);
  });

  it("take each path parameter as a required string", () => {
    const get = inputSchemaFor(TOOLS.find((t) => t.name === "get_notebook_page")!);
    expect(get.properties).toEqual(expect.objectContaining({ tripId: { type: "string" }, pageId: { type: "string" } }));
    expect(get.required).toEqual(["tripId", "pageId"]);
  });

  it("offer publish nothing but the Playbook it publishes", () => {
    const publish = inputSchemaFor(TOOLS.find((t) => t.name === "publish_playbook")!);
    expect(Object.keys(publish.properties ?? {})).toEqual(["playbookId"]);
  });
});
