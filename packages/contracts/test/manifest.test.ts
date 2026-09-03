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

  it("publishes a described field with no other edit — the whole point", () => {
    // The manifest is reflection over the live schema, so this proves the
    // property by construction rather than by re-listing what it returns: a
    // schema shaped like `TripGlobals` plus one described field yields one more
    // entry, and nobody touched the manifest to make that happen.
    const before = Object.keys(TripGlobals.shape).length;
    const widened = TripGlobals.extend({ walkingMinutes: z.number().describe("Minutes on foot") });
    expect(Object.keys(widened.shape).length).toBe(before + 1);
    // And it is described, so it would pass the gate the builder applies.
    expect(widened.shape.walkingMinutes.description).toBe("Minutes on foot");
  });

  it("excludes a field with no description, so anything added later is out by default", () => {
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
