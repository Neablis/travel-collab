// **Spelled for every client, accepting what zod accepts** (M55 part 9).
// `toolSchemaOf` rewrites zod's JSON Schema; the parity test reads both sides
// through it, so a rewrite that changed what a tool accepts would pass there.
// Here zod itself, its raw rendering and the served one vote on the same values,
// through the Ajv the MCP SDK validates with.
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toolSchemaOf } from "./schemas";

// The three shapes `portable` rewrites, as the declarations hold them: a
// mark's `attrs`, an unknown node's `raw`, and a nullable primitive.
const SOURCE = z.object({
  attrs: z.record(z.string(), z.unknown()),
  raw: z.unknown(),
  flightNumber: z.string().nullable().default(null),
  language: z.string().nullable(),
});

const EVERY_JSON_TYPE = [null, 1, 1.5, "s", true, [], [null, 2], {}, { href: "x" }];
const CASES: Record<string, unknown[]> = {
  attrs: [...EVERY_JSON_TYPE, { href: "x", n: null, deep: { a: [1] } }],
  raw: EVERY_JSON_TYPE,
  flightNumber: EVERY_JSON_TYPE,
  language: EVERY_JSON_TYPE,
};
// Each case varies one field of this. It must pass, or every vote is a refusal
// and the three agree about nothing (zod renders `raw` as required).
const VALID = { attrs: {}, raw: null, language: null };

describe("toolSchemaOf", () => {
  it("accepts exactly what zod and zod's own JSON Schema accept, on each shape it rewrites", () => {
    const ajv = new AjvJsonSchemaValidator();
    // zod's and the SDK's JSON Schema types disagree on `$vocabulary`, which neither schema has.
    const raw = ajv.getValidator(z.toJSONSchema(SOURCE, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>);
    const served = ajv.getValidator(toolSchemaOf(SOURCE));
    expect(SOURCE.safeParse(VALID).success).toBe(true);
    const disagreements = Object.entries(CASES).flatMap(([field, values]) =>
      values.map((value) => {
        const input = { ...VALID, [field]: value };
        const votes = { zod: SOURCE.safeParse(input).success, raw: raw(input).valid, served: served(input).valid };
        return votes.zod === votes.raw && votes.raw === votes.served ? null : `${field}=${JSON.stringify(value)}: ${JSON.stringify(votes)}`;
      }),
    );
    expect(disagreements.filter((d) => d !== null)).toEqual([]);
  });
});
