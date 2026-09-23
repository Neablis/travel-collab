import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BatchableCommand } from "@tc/contracts";
import { ID_FIELDS } from "./idFields";

// A field whose schema is a uuid (possibly wrapped in optional/nullable). The
// resolver/schema-transform must know its role, so it must be in ID_FIELDS —
// except `tripId`, which is a universal server-injected field.
function isUuidField(schema: z.ZodTypeAny): boolean {
  let s: z.ZodTypeAny = schema;
  // Unwrap optional/nullable/default wrappers.
  while (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault) {
    s = s._def.innerType;
  }
  if (!(s instanceof z.ZodString)) return false;
  return (s._def.checks ?? []).some((c: { kind: string }) => c.kind === "uuid");
}

describe("ID_FIELDS manifest", () => {
  it("classifies every uuid-bearing command field (except tripId)", () => {
    for (const option of BatchableCommand.options) {
      const type = option.shape.type.value as keyof typeof ID_FIELDS;
      const spec = ID_FIELDS[type];
      for (const [field, fieldSchema] of Object.entries(option.shape)) {
        if (field === "tripId" || field === "type") continue;
        if (isUuidField(fieldSchema as z.ZodTypeAny)) {
          expect(spec, `${type}.${field} is a uuid field but missing from ID_FIELDS`).toHaveProperty(field);
        }
      }
    }
  });

  it("has an entry for every command type", () => {
    const types = BatchableCommand.options.map((o) => o.shape.type.value).sort();
    expect(Object.keys(ID_FIELDS).sort()).toEqual(types);
  });
});
