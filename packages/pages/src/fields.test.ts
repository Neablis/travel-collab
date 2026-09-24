import { describe, expect, it } from "vitest";
import { MANIFEST_OBJECTS, buildAttributeManifest } from "@tc/contracts";
import { fieldAt, fieldChoices } from "./fields";

// The `field` input's vocabulary. The manifest is the only source: these
// tests hold the choices to it in both directions, so a field annotated
// tomorrow is offered with no edit here and an unannotated one never is.

describe("fieldChoices", () => {
  it("offers exactly the manifest's published fields for each object, by label", () => {
    const manifest = buildAttributeManifest();
    for (const of of MANIFEST_OBJECTS) {
      const expected = manifest
        .filter((entry) => entry.object === of)
        .flatMap((entry) =>
          entry.kind === "value"
            ? [`${of}.${entry.field}`]
            : entry.fields.map((f) => `${of}.${entry.collection}.${f.field}`),
        );
      const choices = fieldChoices(of);
      expect(choices.map((c) => c.path), `${of}'s paths`).toEqual(expected);
      for (const choice of choices) {
        // ADR-037 oq4: the reader picks from labels and never sees a path.
        expect(choice.label, `${choice.path} is labelled with its own path`).not.toContain(".");
        expect(choice.group).not.toBe("");
      }
    }
  });

  it("groups a collection's members under the collection's own label", () => {
    const days = fieldChoices("trip").filter((c) => c.path.startsWith("trip.days."));
    expect(days.length).toBeGreaterThan(0);
    expect(new Set(days.map((c) => c.group))).toEqual(new Set(["Every day of the trip"]));
    // And a top-level value sits under the object's own heading, not a collection's.
    expect(fieldChoices("stop").find((c) => c.path === "stop.title")).toMatchObject({ label: "Name", group: "The stop" });
  });

  it("drops a hidden stop field, so the exclusion list reaches the picker", () => {
    expect(fieldChoices("stop", ["title"]).map((c) => c.path)).not.toContain("stop.title");
    expect(fieldChoices("stop").map((c) => c.path)).toContain("stop.title");
  });
});

describe("fieldAt", () => {
  it("finds a published field and refuses everything else, never throwing", () => {
    expect(fieldAt("stop", "stop.cost")).toMatchObject({ label: "Cost", valueKind: "money" });
    // Another object's field is not this input's, even though it is published.
    expect(fieldAt("stop", "trip.name")).toBeUndefined();
    // Gap 6: an unannotated snapshot field (`bookedBy` holds user ids) is not
    // reachable by naming it.
    expect(fieldAt("stop", "stop.bookedBy")).toBeUndefined();
    for (const junk of [undefined, null, 3, "", "stop", "stop.", {}]) {
      expect(fieldAt("stop", junk), JSON.stringify(junk)).toBeUndefined();
    }
  });
});
