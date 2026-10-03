// **What a tool's schema says to the model, as against what the server checks.**
//
// The SDK turns a tool's zod input into JSON Schema and sends it on every step
// of a turn. That conversion is faithful, which is the problem: it writes out
// every bound the server enforces, and most of them tell a model nothing it
// would act on. `minLength: 1` / `maxLength: 200` sat on 33 strings, lat and
// lng carried their ranges, every object said `additionalProperties: false`,
// and each tool opened with a `$schema` URL — measured 2026-10-03 at roughly
// 1,100 of an edit turn's ~8,700 input tokens per step, paid again on every
// step (`ai/contextBudget.test.ts` holds the current figures).
//
// **Validation does not change.** The schema handed to the SDK keeps the zod
// schema's own `validate`, so a call is checked against every bound exactly as
// before; a model that sends a 201-character title is refused as it always
// was, and the repair path sees the same error. Only the text the model reads
// is shorter.
//
// What is dropped, and why each is safe to drop:
//   - `$schema`: a dialect URL, read by no model.
//   - `minLength` / `maxLength`: generic caps (1, 200, 2000, 20) no sensible
//     value comes near; anything that matters is said in the description.
//   - `minimum` / `maximum` / `exclusive*`: coordinate ranges, non-negative
//     amounts, 1-based day numbers — the instruction already states the last.
//   - `additionalProperties: false`, **only where zod does not enforce it**. A
//     plain `z.object` strips unknown keys silently, so a model adding one
//     loses nothing; the SDK writes `false` on every object regardless. A
//     tool containing a `.strict()` object keeps every `false` it was given,
//     because there an extra key IS a refused call and the model should be
//     told (see `containsStrictObject`).
// What is kept: types, `enum`/`const`, `required`, descriptions, `pattern`
// (dates and country codes are formats a model gets wrong without it) and
// `minItems`/`maxItems` (the 4/5/8 batch limits are real decisions).
import { jsonSchema, zodSchema, type JSONSchema7, type Schema } from "ai";
import { ZodType, type ZodTypeAny } from "zod";

/** Keywords removed from every schema node the model reads. */
export const MODEL_HIDDEN_KEYWORDS = [
  "$schema",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
] as const;

// Keys whose value is a MAP of name → subschema: the names are data, not
// keywords, so a property called `minimum` must survive.
const SCHEMA_MAPS = ["properties", "patternProperties", "definitions", "$defs"] as const;
// Keys whose value is one subschema, or an array of them.
const SCHEMA_SLOTS = ["items", "additionalItems", "contains", "not", "if", "then", "else", "anyOf", "oneOf", "allOf", "prefixItems"] as const;

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A JSON Schema with the model-irrelevant keywords removed, recursively. Pure,
 * and it never edits its input. `keepClosed` keeps `additionalProperties: false`
 * (a tool whose zod refuses unknown keys); without it those are dropped.
 */
export function slimForModel(schema: JSONSchema7, keepClosed: boolean): JSONSchema7 {
  const slim = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(slim);
    if (!isNode(node)) return node;
    const out: Node = {};
    for (const [key, value] of Object.entries(node)) {
      if ((MODEL_HIDDEN_KEYWORDS as readonly string[]).includes(key)) continue;
      if (key === "additionalProperties") {
        if (value === false && !keepClosed) continue;
        out[key] = isNode(value) ? slim(value) : value;
      } else if ((SCHEMA_MAPS as readonly string[]).includes(key) && isNode(value)) {
        out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, slim(sub)]));
      } else if ((SCHEMA_SLOTS as readonly string[]).includes(key)) {
        out[key] = slim(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  };
  return slim(schema) as JSONSchema7;
}

/**
 * Whether any object in a zod (v3) schema refuses unknown keys — `.strict()`
 * anywhere in the tree, through optionals, unions, effects and lazies alike.
 * Walked generically over `_def` rather than per schema kind, so a wrapper zod
 * adds later is followed without an edit here.
 */
export function containsStrictObject(schema: ZodTypeAny, seen: Set<unknown> = new Set()): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const def = schema._def as Node;
  if (def.typeName === "ZodObject") {
    if (def.unknownKeys === "strict") return true;
    const shape = (typeof def.shape === "function" ? (def.shape as () => Node)() : {}) as Node;
    if (Object.values(shape).some((sub) => sub instanceof ZodType && containsStrictObject(sub, seen))) return true;
  }
  if (def.typeName === "ZodLazy" && typeof def.getter === "function") {
    return containsStrictObject((def.getter as () => ZodTypeAny)(), seen);
  }
  for (const value of Object.values(def)) {
    const subs = Array.isArray(value) ? value : [value];
    if (subs.some((sub) => sub instanceof ZodType && containsStrictObject(sub, seen))) return true;
  }
  return false;
}

/**
 * A tool's `inputSchema` for the SDK: the slimmed JSON Schema for the model to
 * read, and the zod schema's own validation for the server to enforce.
 */
export function modelFacingSchema(input: ZodTypeAny): Schema<unknown> {
  const full = zodSchema(input) as Schema<unknown>;
  const keepClosed = containsStrictObject(input);
  return jsonSchema<unknown>(async () => slimForModel(await full.jsonSchema, keepClosed), {
    validate: (value) => full.validate!(value),
  });
}
