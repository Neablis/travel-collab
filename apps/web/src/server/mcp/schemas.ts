import { z } from "zod";
import { DECLARED, MAX_PAGE_LIMIT } from "@/server/public-api/route";
import { pathParams, type McpTool } from "./tools";

// **A tool's input schema is its route's, never written again** (M55 D2). The
// declaration's own Zod (`handler[DECLARED].def`) goes through `z.toJSONSchema`
// with the JSON Schema target MCP reads, rather than the `openapi-3.0` one the
// REST reference uses. Rules a JSON Schema cannot hold (`PatchPlaybookBody`'s
// `superRefine`) are said in the tool's description, and the route still
// enforces them.

/** What `tools/list` hands a client: MCP wants an object at the root. */
export type InputSchema = { type: "object"; properties?: Record<string, object>; required?: string[] } & Record<
  string,
  unknown
>;

/** The JSON Schema of what a declaration validates: its body, else its query. */
function routeSchema(tool: McpTool): Record<string, unknown> | null {
  const def = tool.handler[DECLARED].def;
  const source = def.body ?? def.query;
  return source === undefined
    ? null
    : (z.toJSONSchema(source, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>);
}

/**
 * The `?limit=` and `?cursor=` the wrapper owns on every collection
 * (`route.ts`), offered where the declaration has no word for them.
 */
export const PAGING: Readonly<Record<string, object>> = {
  limit: { type: "integer", minimum: 1, maximum: MAX_PAGE_LIMIT, description: "How many to return. Default 50." },
  cursor: { type: "string", description: "The `nextCursor` a previous page gave, for the page after it." },
};

/** The input schema `tools/list` serves for `tool`: its route's own, plus its path parameters and paging. */
export function inputSchemaFor(tool: McpTool): InputSchema {
  const route = routeSchema(tool) ?? { type: "object", properties: {} };
  const routeProperties = (route.properties ?? {}) as Record<string, object>;
  const offered = (name: string) =>
    (tool.offers === undefined || tool.offers.includes(name)) && !(tool.fixed !== undefined && name in tool.fixed);

  const properties: Record<string, object> = {};
  for (const name of pathParams(tool)) properties[name] = { type: "string" };
  for (const [name, schema] of Object.entries(routeProperties)) if (offered(name)) properties[name] = schema;
  if (tool.handler[DECLARED].kind === "collection") Object.assign(properties, PAGING);

  // A union body (`create_playbook`'s) has its fields in its branches, so it
  // is passed whole; a path parameter beside it would fall foul of each
  // branch's `additionalProperties: false`.
  if (route.properties === undefined && route.anyOf !== undefined) {
    if (pathParams(tool).length > 0) throw new Error(`${tool.name}: a union body cannot sit beside path parameters`);
    return { ...route, type: "object" };
  }
  const required = [...pathParams(tool), ...((route.required ?? []) as string[]).filter(offered)];
  const schema: InputSchema = { ...route, type: "object", properties };
  delete schema.required;
  if (required.length > 0) schema.required = required;
  return schema;
}
