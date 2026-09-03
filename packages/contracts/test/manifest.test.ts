import { z } from "zod";
import { describe, expect, it } from "vitest";
import { AttributeRef, buildAttributeManifest, TripGlobals } from "../src";

describe("the attribute manifest", () => {
  it("lists the trip's collections with the fields readable off each member", () => {
    const manifest = buildAttributeManifest();
    const cities = manifest.find((e) => e.kind === "collection" && e.collection === "cities");
    expect(cities).toBeDefined();
    expect(cities!.kind === "collection" && cities!.fields.map((f) => f.field)).toEqual([
      "name",
      "dayIndexes",
      "activityCount",
    ]);
  });

  it("lists a top-level number as a value rather than a collection", () => {
    const manifest = buildAttributeManifest();
    const booked = manifest.find((e) => e.kind === "value" && e.field === "bookedCount");
    expect(booked).toBeDefined();
    expect(booked!.label).toBe("How many stops are booked");
  });

  it("carries the human label from `.describe()`, which is what the picker shows", () => {
    const manifest = buildAttributeManifest();
    const days = manifest.find((e) => e.kind === "collection" && e.collection === "days");
    expect(days!.label).toBe("Every day of the trip");
    // Through a `.nullable()` wrapper too — `date` is `z.string().nullable()`,
    // and a reader would reasonably expect the description to survive the wrap.
    const dateField = days!.kind === "collection" && days!.fields.find((f) => f.field === "date");
    expect(dateField && dateField.label).toBe("The day's date, or nothing if the trip has no start date");
  });

  // ────────────────────────────────────────────────────────────────────────
  // The requirement itself, in both directions. ADR-037: "a developer adding a
  // new global attribute gets it for free" — AND "exposure must be opt-in ...
  // free-by-default over a whole schema is a leak".
  // ────────────────────────────────────────────────────────────────────────

  // REWRITTEN after CodeRabbit's review of #134, which was right about it: the
  // original test here was called "publishes a described field with no other
  // edit — the whole point" and never called `buildAttributeManifest` at all.
  // It asserted that `TripGlobals.extend(...)` adds a key and that `.describe()`
  // sets a description — i.e. it tested Zod, not this module — so a regression
  // in the reflection would have sailed past it under a name claiming otherwise.
  //
  // CodeRabbit proposed adding a seam: let `buildAttributeManifest` take the
  // declared roots as an argument so a test could pass a widened schema.
  // **Not taken, and the reason is the thing the seam would undo.** The
  // module's safety property is that only `MANIFEST_ROOTS` is ever walked and
  // there is NO entry point that walks anything else — that is what stops
  // `TripDetail`'s internals reaching a picker. A parameter would make "walk
  // this instead" a supported call, and the guarantee would become a
  // convention.
  //
  // The property survives without it, and the test below is where: the manifest
  // and the root's described fields are asserted to be the SAME SET. Add a
  // described field to `TripGlobals` and that test fails until the manifest
  // reflects it, which is exactly "a developer adding an attribute gets it for
  // free" — proved against the real root rather than a stand-in.

  it("lists exactly the root's described fields — add one and it is published, with no other edit", () => {
    // The failure this prevents: `TripDetail` carries `dismissedConflictIds`,
    // `forkedFrom` and internal uuids. If exposure were opt-OUT, every future
    // contract field would be published into a user-facing picker until someone
    // noticed.
    const manifest = buildAttributeManifest();
    for (const entry of manifest) {
      expect(entry.label, `${JSON.stringify(entry)} has no label`).toBeTruthy();
      if (entry.kind === "collection") {
        for (const f of entry.fields) expect(f.label).toBeTruthy();
      }
    }
    // Every entry corresponds to a described field on the root, and nothing
    // else on the root is missing from it — the two sets agree exactly.
    const described = Object.entries(TripGlobals.shape)
      .filter(([, s]) => (s as z.ZodTypeAny).description !== undefined)
      .map(([k]) => k)
      .sort();
    const listed = manifest.map((e) => (e.kind === "collection" ? e.collection : e.field)).sort();
    expect(listed).toEqual(described);
  });

  it("walks only the declared roots, never the whole contracts package", () => {
    // There is no "walk everything" entry point, so this asserts the shape of
    // what came back rather than the absence of a call: every entry is the trip.
    for (const entry of buildAttributeManifest()) expect(entry.object).toBe("trip");
  });
});

describe("AttributeRef", () => {
  it("accepts a collection lookup and a bare value", () => {
    expect(AttributeRef.parse({ object: "trip", collection: "cities", key: "Tokyo", field: "activityCount" }))
      .toEqual({ object: "trip", collection: "cities", key: "Tokyo", field: "activityCount" });
    expect(AttributeRef.parse({ object: "trip", field: "bookedCount" }).field).toBe("bookedCount");
  });

  it("refuses a string expression, which is the point of storing it structured", () => {
    // `{{trip.cities[Tokyo].activities.length}}` has no home in this shape, and
    // that is deliberate: ADR-037 dropped the syntax because a freeform string
    // has no declared inputs, gets no control, and cannot express a lookup that
    // misses.
    expect(AttributeRef.safeParse("trip.cities[Tokyo].activityCount").success).toBe(false);
    expect(AttributeRef.safeParse({ object: "trip", field: "" }).success).toBe(false);
    // `.strict()`, so an extra key is a parse error rather than something we
    // would drop on the next save.
    expect(AttributeRef.safeParse({ object: "trip", field: "bookedCount", expr: "x" }).success).toBe(false);
  });
});
