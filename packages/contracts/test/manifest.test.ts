import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  ActivityKind,
  ActivityTag,
  annotationOf,
  AttributeEntry,
  AttributeFieldRef,
  AttributeRef,
  buildAttributeManifest,
  described,
  HIDDEN_STOP_FIELDS,
  Location,
  MANIFEST_OBJECTS,
  MANIFEST_ROOTS,
  Money,
  TripGlobals,
  unwrapSchema,
  valueKindOf,
} from "../src";

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

  it("lists exactly the roots' annotated fields — add one and it is published, with no other edit", () => {
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
    // Every entry corresponds to an annotated field on a root, and nothing
    // annotated on a root is missing from it — the two sets agree exactly.
    // "Annotated" is what `described()` or `describedCollection()` recorded; a
    // bare `.describe()` does not count, which is the gate pinned below.
    // `HIDDEN_STOP_FIELDS` is empty, so nothing is subtracted for it.
    const annotated = Object.entries(MANIFEST_ROOTS)
      .flatMap(([object, roots]) => roots.flatMap((root) => Object.entries(root.shape as z.ZodRawShape)
        .filter(([, s]) => annotationOf(s) !== undefined)
        .map(([k]) => `${object}.${k}`)))
      .sort();
    const listed = manifest.map((e) => `${e.object}.${e.kind === "collection" ? e.collection : e.field}`).sort();
    expect(listed).toEqual(annotated);
    expect(listed.length, "the witness: an empty manifest agrees with an empty root").toBeGreaterThan(10);
  });

  it("walks only the declared roots, never the whole contracts package", () => {
    // There is no "walk everything" entry point, so this asserts the shape of
    // what came back rather than the absence of a call: every entry is one of
    // the declared objects.
    for (const entry of buildAttributeManifest()) expect(MANIFEST_OBJECTS).toContain(entry.object);
  });

  it("never lets two schemas under one object claim the same field name", () => {
    // `trip` is read off two schemas — the delivered globals and the facts
    // `attribute` reads. A key on both would publish two entries with one
    // path, and a stored `trip.<key>` could not say which it meant.
    for (const [object, roots] of Object.entries(MANIFEST_ROOTS)) {
      const keys = roots.flatMap((root) => Object.keys(root.shape));
      expect(new Set(keys).size, object).toBe(keys.length);
    }
  });
});

// ADR-037 open question 4 made `.describe()` the opt-in, and `.describe()` is
// ALSO the OpenAPI text of every public-API schema (`zod-to-json-schema` reads
// it). One call with two meanings let API wording reach the picker, and made a
// field described for the API alone a published one. M14 T06 moved the gate to
// the annotation `described()` records; `.description` decides nothing here.
describe("the opt-in gate is described(), not .describe()", () => {
  it("reads the picker's label from the annotation, not from a later .describe()", () => {
    const schema = described("text", "Picker label", z.string()).nullable().describe("API wording");
    expect(annotationOf(schema)?.label).toBe("Picker label");
    expect(annotationOf(z.string().describe("API wording"))).toBeUndefined();
  });
});

// M14 field widget, build step 2: the stop's fields become pickable.
describe("the stop root", () => {
  const stopFields = (manifest = buildAttributeManifest()) =>
    manifest.flatMap((e) => (e.object === "stop" && e.kind === "value" ? [e.field] : []));

  it("publishes the stop fields a reader may pick", () => {
    expect(stopFields()).toEqual(["title", "location", "notes", "kind", "tags", "cost"]);
  });

  it("never publishes a field holding user ids", () => {
    // `bookedBy` and `participants` are member user ids (M13 link 5). A page is
    // a shared document, so an id printed into it is handed to everyone who can
    // read the page — and `person` is out of M14 (Decided 2026-09-24, item 5).
    const published = stopFields();
    expect(published.length, "the witness").toBeGreaterThan(0);
    for (const field of ["bookedBy", "participants"]) expect(published).not.toContain(field);
  });

  it("hides a field named on the exclusion list, and nothing else", () => {
    expect(stopFields(buildAttributeManifest(["cost"]))).toEqual(["title", "location", "notes", "kind", "tags"]);
    expect(HIDDEN_STOP_FIELDS).toEqual([]);
    // Typed over the snapshot's keys, so a renamed field fails the build rather
    // than silently un-hiding. `tsc` is the assertion on this line.
    // @ts-expect-error — not a field of ActivitySnapshot
    buildAttributeManifest(["titel"]);
  });
});

// T05 found a kind is accepted whatever the schema under it — `enum` on a
// string, `location` on any object — and a formatter chosen by kind then meets
// a value it cannot print. Checked over the manifest, since that is every field
// a formatter will ever be handed.
describe("a value kind fits the schema it labels", () => {
  const fits = (kind: string, schema: z.ZodTypeAny): boolean => {
    let inner = unwrapSchema(schema);
    if (inner instanceof z.ZodArray) inner = unwrapSchema(inner.element as z.ZodTypeAny);
    switch (kind) {
      case "text":
      case "date":
        return inner instanceof z.ZodString;
      case "count":
      case "duration":
        return inner instanceof z.ZodNumber;
      case "money":
        // Two shapes today: an integer in the trip's currency (`costSubtotal`)
        // and a stop's own `Money`, which carries its currency.
        return inner instanceof z.ZodNumber || (inner instanceof z.ZodObject && inner.shape === Money.shape);
      case "enum":
        return inner instanceof z.ZodEnum;
      case "location":
        // `Location` is a refined object, so `described()`'s clone of it is a
        // ZodEffects sharing the original's inner schema.
        return inner instanceof z.ZodEffects && inner._def.schema === Location._def.schema;
      default:
        return false;
    }
  };

  const schemaOf = (object: string, name: string, member?: string): z.ZodTypeAny => {
    const roots: readonly z.AnyZodObject[] = MANIFEST_ROOTS[object as keyof typeof MANIFEST_ROOTS];
    const field = roots.find((r) => name in r.shape)!.shape[name] as z.ZodTypeAny;
    if (member === undefined) return field;
    const element = (unwrapSchema(field) as z.ZodArray<z.AnyZodObject>).element;
    return element.shape[member] as z.ZodTypeAny;
  };

  it("rejects the two mismatches T05 found silently accepted", () => {
    // The sweep below proves nothing unless this check can say no.
    expect(fits("enum", z.string())).toBe(false);
    expect(fits("location", z.object({ name: z.string() }))).toBe(false);
    expect(fits("location", described("location", "Where", Location).nullable())).toBe(true);
  });

  it("holds for every published field", () => {
    let checked = 0;
    for (const entry of buildAttributeManifest()) {
      if (entry.kind === "value") {
        checked += 1;
        expect(fits(entry.valueKind, schemaOf(entry.object, entry.field)), `${entry.object}.${entry.field}`).toBe(true);
      } else {
        for (const f of entry.fields) {
          checked += 1;
          expect(fits(f.valueKind, schemaOf(entry.object, entry.collection, f.field)), `${entry.collection}.${f.field}`).toBe(true);
        }
      }
    }
    expect(checked, "the witness").toBeGreaterThan(15);
  });
});

// "Distinct" (answer 3) and an enum's formatter both need the vocabulary, and
// a picker is never handed the schema to read it off.
describe("an enum field's allowed values", () => {
  it("are published beside it, element-wise for a list", () => {
    const manifest = buildAttributeManifest();
    const value = (field: string) => manifest.find((e) => e.object === "stop" && e.kind === "value" && e.field === field);
    expect(value("kind")).toMatchObject({ valueKind: "enum", values: ActivityKind.options });
    expect(value("tags")).toMatchObject({ valueKind: "enum", list: true, values: ActivityTag.options });
    const tags = manifest.find((e) => e.kind === "collection" && e.collection === "tags");
    expect(tags?.kind === "collection" && tags.fields.find((f) => f.field === "tag")?.values).toEqual(ActivityTag.options);
  });

  it("are absent on every field that is not an enum", () => {
    let checked = 0;
    for (const entry of buildAttributeManifest()) {
      for (const f of entry.kind === "value" ? [entry] : entry.fields) {
        if (f.valueKind === "enum") continue;
        checked += 1;
        expect(f, JSON.stringify(f)).not.toHaveProperty("values");
      }
    }
    expect(checked, "the witness").toBeGreaterThan(10);
  });
});

// Two vocabularies were one too many (M14 field-widget review): `attribute`
// read a hand-written enum while the manifest described the same kind of
// thing. The enum is now the paths of the facts roots, so every field a stored
// `attribute` widget names is a manifest entry.
describe("AttributeFieldRef", () => {
  it("names only fields the manifest publishes", () => {
    const published = new Set(buildAttributeManifest().flatMap((e) => (e.kind === "value" ? [`${e.object}.${e.field}`] : [])));
    expect(AttributeFieldRef.options.length, "the witness").toBeGreaterThan(0);
    for (const path of AttributeFieldRef.options) expect(published, path).toContain(path);
  });

  it("keeps every name a stored page may already hold", () => {
    // Stored documents carry these strings; renaming one needs a
    // PAGE_DOC_MIGRATIONS step, so a change to this list must be deliberate.
    expect(AttributeFieldRef.options).toEqual([
      "trip.name",
      "trip.budgetRemaining",
      "trip.countdown",
      "account.name",
      "account.homeAirport",
    ]);
  });
});

describe("AttributeRef", () => {
  it("accepts a collection field, a bare value and a stop field", () => {
    expect(AttributeRef.parse({ object: "trip", collection: "cities", field: "activityCount" }))
      .toEqual({ object: "trip", collection: "cities", field: "activityCount" });
    expect(AttributeRef.parse({ object: "trip", field: "bookedCount" }).field).toBe("bookedCount");
    expect(AttributeRef.parse({ object: "stop", field: "cost" }).object).toBe("stop");
  });

  it("refuses a member key — the item is chosen by the filters, never stored here", () => {
    // M14 field-widget review, gap 4: `key: "Tokyo"` duplicated the `city`
    // filter, and in a link-10 template it named a city of some other trip.
    // Which member is read is the widget's filters plus `narrow`.
    expect(AttributeRef.safeParse({ object: "trip", collection: "cities", key: "Tokyo", field: "activityCount" }).success).toBe(false);
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

// ADR-037 open question 4: "'how to serialize them' becomes a small closed set
// of value kinds — money, date, count, text, duration — each with one
// formatter." Missing until Copilot flagged it on PR 134: with a label alone,
// `costSubtotal` was indistinguishable from `activityCount`, so the manifest
// could name a field and still not say how to print it.
describe("value kinds", () => {
  const days = () => {
    const entry = buildAttributeManifest().find((e) => e.kind === "collection" && e.collection === "days");
    if (!entry || entry.kind !== "collection") throw new Error("days collection missing");
    return entry;
  };

  it("distinguishes money from a plain count on the same collection", () => {
    const fields = days().fields;
    expect(fields.find((f) => f.field === "costSubtotal")?.valueKind).toBe("money");
    expect(fields.find((f) => f.field === "activityCount")?.valueKind).toBe("count");
  });

  it("distinguishes a date from a name", () => {
    expect(days().fields.find((f) => f.field === "date")?.valueKind).toBe("date");
    const cities = buildAttributeManifest().find((e) => e.kind === "collection" && e.collection === "cities");
    if (!cities || cities.kind !== "collection") throw new Error("cities collection missing");
    expect(cities.fields.find((f) => f.field === "name")?.valueKind).toBe("text");
  });

  it("gives every listed field a kind, so a generic widget always has a formatter", () => {
    let checked = 0;
    for (const entry of buildAttributeManifest()) {
      if (entry.kind === "value") {
        checked += 1;
        expect(entry.valueKind, `${entry.field} has no value kind`).toBeDefined();
      } else {
        for (const f of entry.fields) {
          checked += 1;
          expect(f.valueKind, `${entry.collection}.${f.field} has no value kind`).toBeDefined();
        }
      }
    }
    // The witness: without it this passes over an empty manifest.
    expect(checked, "no field was inspected").toBeGreaterThan(5);
  });

  // M14's field-widget review (2026-09-24, gap 3): `days.cities` was published
  // as a scalar "text" and `cities.dayIndexes` as a scalar "count", so a
  // formatter picked by kind alone would print an array as one string or one
  // number. The kind names the element; `list` says there are many of them.
  it("marks an array field as a list of its kind, and leaves a scalar unmarked", () => {
    const fields = days().fields;
    expect(fields.find((f) => f.field === "cities")).toEqual({
      field: "cities",
      label: "The cities this day touches, in arrival order",
      valueKind: "text",
      list: true,
    });
    const cities = buildAttributeManifest().find((e) => e.kind === "collection" && e.collection === "cities");
    if (!cities || cities.kind !== "collection") throw new Error("cities collection missing");
    expect(cities.fields.find((f) => f.field === "dayIndexes")).toMatchObject({ valueKind: "count", list: true });
    expect(fields.find((f) => f.field === "date")).not.toHaveProperty("list");
  });

  it("labels a closed vocabulary as an enum, not free text", () => {
    const tags = buildAttributeManifest().find((e) => e.kind === "collection" && e.collection === "tags");
    if (!tags || tags.kind !== "collection") throw new Error("tags collection missing");
    expect(tags.fields.find((f) => f.field === "tag")?.valueKind).toBe("enum");
  });

  it("parses its own output through AttributeEntry", () => {
    // The point of making `AttributeEntry` a schema rather than a bare type
    // (Copilot, PR 134): the builder's output is now checkable, so a malformed
    // entry is a test failure instead of a shape nobody validates.
    for (const entry of buildAttributeManifest()) expect(AttributeEntry.parse(entry)).toEqual(entry);
  });
});

// The value kind rides in a `WeakMap` keyed by the schema object `described()`
// returned, and every later combinator returns a NEW object wrapping it. The
// label lookup already walked those wrappers; the kind lookup did not, so a
// field written the ordinary way was published with a label and no kind —
// "listed but not printable", which is worse than either answer alone because
// the entry looks complete. Found by Copilot on PR 139.
describe("a value kind through a schema wrapper", () => {
  it("survives a combinator applied after described()", () => {
    expect(valueKindOf(described("date", "When", z.string()).nullable())).toBe("date");
    expect(valueKindOf(described("money", "Cost", z.number()).optional())).toBe("money");
    // Two deep, because `.nullable().optional()` is a shape real schemas take.
    expect(valueKindOf(described("count", "How many", z.number()).nullable().optional())).toBe("count");
  });

  it("still reads a kind attached to an already-wrapped schema", () => {
    // The other order, which worked before and must keep working: the kind is
    // on the OUTER object here, and the walk must not skip past it.
    expect(valueKindOf(described("text", "Notes", z.string().nullable()))).toBe("text");
  });

  it("gives a collection no kind — it is walked for its fields, never printed", () => {
    // `days`, `cities` and `tags` were each `described("text", …)`, a kind the
    // manifest silently dropped because a collection entry has nowhere to put
    // one. A wrong label that nothing reads is still a wrong label.
    for (const name of ["days", "cities", "tags"] as const) {
      expect(valueKindOf(TripGlobals.shape[name]), name).toBeUndefined();
    }
  });

  it("answers undefined for a bare describe(), wrapped or not", () => {
    expect(valueKindOf(z.string().describe("Just a label"))).toBeUndefined();
    expect(valueKindOf(z.string().describe("Just a label").nullable())).toBeUndefined();
  });
});
