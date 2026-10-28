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

/**
 * A declaration's Zod as the JSON Schema a tool serves: zod's own rendering,
 * spelled so every MCP client reads it the same (M55 part 9).
 */
export function toolSchemaOf(source: z.ZodType): Record<string, unknown> {
  return portable(z.toJSONSchema(source, { target: "draft-2020-12", io: "input" })) as Record<string, unknown>;
}

/** The JSON Schema of what a declaration validates: its body, else its query. */
function routeSchema(tool: McpTool): Record<string, unknown> | null {
  const def = tool.handler[DECLARED].def;
  const source = def.body ?? def.query;
  return source === undefined ? null : toolSchemaOf(source);
}

// **Two spellings zod chooses that not every client reads** (the MCP
// Inspector's "schema portability" warnings). Neither changes what a schema
// accepts:
//
//   - `z.unknown()` is `{}`, a schema with no keyword at all. As a record's
//     values (a mark's `attrs`, a widget's `params`) it is
//     `additionalProperties: true`; anywhere else (an unknown node's `raw`,
//     which carries a node this build cannot read, as it came) it is any JSON
//     value, named type by type.
//   - `.nullable()` on a primitive is `type: ["string", "null"]`, which some
//     clients read as its first type alone. It is an `anyOf` of one type each.
const ANY_JSON_VALUE = ["object", "array", "string", "number", "boolean", "null"].map((type) => ({ type }));
const VALIDATES = ["type", "enum", "const", "anyOf", "oneOf", "allOf", "not", "$ref"];
const ANNOTATIONS = ["title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly"];
const SUBSCHEMA = ["items", "not", "contains", "propertyNames", "if", "then", "else"];
const SUBSCHEMA_LISTS = ["anyOf", "oneOf", "allOf", "prefixItems"];
const SUBSCHEMA_MAPS = ["properties", "patternProperties", "$defs", "dependentSchemas"];

function portable(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const node: Record<string, unknown> = { ...schema };
  for (const key of SUBSCHEMA) if (key in node) node[key] = portable(node[key]);
  for (const key of SUBSCHEMA_LISTS) if (Array.isArray(node[key])) node[key] = (node[key] as unknown[]).map(portable);
  for (const key of SUBSCHEMA_MAPS) {
    const map = node[key] as Record<string, unknown> | undefined;
    if (map !== undefined) node[key] = Object.fromEntries(Object.entries(map).map(([name, s]) => [name, portable(s)]));
  }
  if ("additionalProperties" in node) {
    const extra = portable(node.additionalProperties);
    node.additionalProperties = isAnyJsonValue(extra) ? true : extra;
  }
  if (Array.isArray(node.type)) {
    // Keywords for one type (`minLength`) go to that type's branch; what
    // describes the whole value (`description`, `default`) stays outside.
    const { type: types, ...rest } = node as { type: string[] } & Record<string, unknown>;
    const outer = Object.fromEntries(Object.entries(rest).filter(([key]) => ANNOTATIONS.includes(key)));
    const inner = Object.fromEntries(Object.entries(rest).filter(([key]) => !ANNOTATIONS.includes(key)));
    return { ...outer, anyOf: types.map((type) => (type === "null" ? { type } : { type, ...inner })) };
  }
  if (!VALIDATES.some((key) => key in node)) return { ...node, anyOf: ANY_JSON_VALUE };
  return node;
}

function isAnyJsonValue(schema: unknown): boolean {
  return (
    typeof schema === "object" &&
    schema !== null &&
    Object.keys(schema).length === 1 &&
    JSON.stringify((schema as { anyOf?: unknown }).anyOf) === JSON.stringify(ANY_JSON_VALUE)
  );
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
