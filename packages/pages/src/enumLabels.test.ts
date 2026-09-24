import { describe, expect, it } from "vitest";
import { ActivityKind, ActivityTag, MANIFEST_OBJECTS } from "@tc/contracts";
import { KIND_LABEL, TAG_LABEL, enumLabel } from "./enumLabels";
import { fieldChoices } from "./fields";

describe("enumLabel", () => {
  // `enumLabel` looks a value up without knowing its field. Two vocabularies
  // sharing a value would give one of them the other's word.
  it("reads from vocabularies that share no value", () => {
    const kinds = new Set<string>(ActivityKind.options);
    expect(ActivityTag.options.filter((tag) => kinds.has(tag))).toEqual([]);
  });

  // The claim the formatter leans on: every enum value a `field` widget can
  // print has a word. Derived from the manifest, so an enum field published
  // tomorrow is checked without this test being edited.
  it("labels every value of every enum field the manifest publishes", () => {
    const values = MANIFEST_OBJECTS.flatMap((of) => fieldChoices(of)).flatMap((choice) => choice.values ?? []);
    // Kinds and tags today; an empty list would pass the loop below vacuously.
    expect(values.length).toBeGreaterThanOrEqual(ActivityKind.options.length + ActivityTag.options.length);
    for (const value of values) expect(enumLabel(value), value).not.toBe(value);
  });

  it("uses the kind and tag words", () => {
    expect(enumLabel("hold")).toBe(KIND_LABEL.hold);
    expect(enumLabel("outdoors")).toBe(TAG_LABEL.outdoors);
  });

  it("prints a value it has no word for as itself", () => {
    expect(enumLabel("retired")).toBe("retired");
    expect(enumLabel("toString")).toBe("toString");
  });
});
