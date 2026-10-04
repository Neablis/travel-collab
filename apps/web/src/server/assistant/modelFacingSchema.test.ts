// The schema a model reads is slimmed; the check a call goes through is not.
// Both halves are pinned here, because the saving is only safe while the second
// one holds — and a third: `additionalProperties: false` stays exactly where
// zod refuses unknown keys, so the model is still told where an extra key is
// a refused call.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { containsStrictObject, modelFacingSchema } from "./modelFacingSchema";

const read = async (input: z.ZodTypeAny) => JSON.stringify(await modelFacingSchema(input).jsonSchema);

describe("what a model reads", () => {
  const input = z.object({
    title: z.string().min(1).max(200).describe("The stop's name."),
    lat: z.number().min(-90).max(90),
    when: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(["planned", "pending"]),
    lines: z.array(z.string().max(200)).min(1).max(4),
    // A property NAMED like a dropped keyword is data, not a keyword.
    minimum: z.number().optional(),
  });

  it("drops the bounds a model does not act on, and the dialect URL", async () => {
    const json = await read(input);
    for (const keyword of ['"$schema"', '"minLength"', '"maxLength"', '"maximum"', '"additionalProperties"']) {
      expect(json).not.toContain(keyword);
    }
  });

  it("keeps types, enums, patterns, item limits, descriptions and required", async () => {
    const schema = (await modelFacingSchema(input).jsonSchema) as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(schema.properties.kind!.enum).toEqual(["planned", "pending"]);
    expect(schema.properties.when!.pattern).toBe("^\\d{4}-\\d{2}-\\d{2}$");
    expect(schema.properties.lines).toMatchObject({ minItems: 1, maxItems: 4 });
    expect(schema.properties.title!.description).toBe("The stop's name.");
    expect(schema.properties.minimum).toEqual({ type: "number" });
    expect(schema.required).toEqual(["title", "lat", "when", "kind", "lines"]);
  });

  it("keeps additionalProperties: false where zod refuses unknown keys, nested or not", async () => {
    const nested = z.object({ outer: z.union([z.object({ a: z.string() }).strict(), z.number()]) });
    expect(containsStrictObject(nested)).toBe(true);
    expect(containsStrictObject(input)).toBe(false);
    expect(await read(nested)).toContain('"additionalProperties":false');
  });
});

describe("what the server checks", () => {
  it("still refuses every bound the model no longer reads", async () => {
    const schema = modelFacingSchema(z.object({ title: z.string().max(5), lat: z.number().max(90) }));
    expect((await schema.validate!({ title: "toolong", lat: 1 })).success).toBe(false);
    expect((await schema.validate!({ title: "ok", lat: 91 })).success).toBe(false);
    expect((await schema.validate!({ title: "ok", lat: 9 })).success).toBe(true);
  });

  it("returns zod's parsed value, so defaults and transforms still apply", async () => {
    const schema = modelFacingSchema(z.object({ n: z.number().default(3) }));
    expect(await schema.validate!({})).toEqual({ success: true, value: { n: 3 } });
  });
});

describe("fields hidden from the model", () => {
  const place = z.object({ name: z.string(), lat: z.number().optional(), precision: z.enum(["venue"]).optional() });
  const input = z.object({ title: z.string(), location: place.nullable().optional() });

  it("removes a nested property, through a nullable union, and keeps its siblings", async () => {
    const json = JSON.stringify(await modelFacingSchema(input, ["location.lat", "location.precision"]).jsonSchema);
    expect(json).not.toContain('"lat"');
    expect(json).not.toContain('"precision"');
    expect(json).toContain('"name"');
  });

  it("still accepts and validates a hidden property when one is sent", async () => {
    const schema = modelFacingSchema(input, ["location.lat"]);
    expect((await schema.validate!({ title: "t", location: { name: "n", lat: 1 } })).success).toBe(true);
    expect((await schema.validate!({ title: "t", location: { name: "n", lat: "north" } })).success).toBe(false);
  });

  it("refuses to hide a required property, and a path that names nothing", async () => {
    await expect(modelFacingSchema(input, ["location.name"]).jsonSchema).rejects.toThrow(/required/);
    await expect(modelFacingSchema(input, ["location.latitude"]).jsonSchema).rejects.toThrow(/names no property/);
  });
});
