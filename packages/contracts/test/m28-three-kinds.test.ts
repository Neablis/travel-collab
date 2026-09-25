import { describe, expect, it } from "vitest";
import {
  ActivityAddedV1,
  ActivityView,
  buildAttributeManifest,
  migratePageDoc,
  PageDoc,
  RETIRED_ACTIVITY_KINDS,
  SavedStop,
  StoredActivityKind,
  TripCommand,
} from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";

// M28 (ADR-054): three kinds. The retired ones are never written again, but
// every event, projection row, saved day and page written before M28 still
// says them, and the log is replayed forever — so each stored shape reads a
// retired kind back as its replacement, and nothing past the parse sees one.
describe("a retired kind is read back as its replacement", () => {
  const EXPECTED = [
    ["idea", "pending"],
    ["hold", "pending"],
    ["booked", "planned"],
  ] as const;

  it("maps each retired kind, and only those", () => {
    expect(RETIRED_ACTIVITY_KINDS).toEqual(Object.fromEntries(EXPECTED));
    for (const [old, now] of EXPECTED) expect(StoredActivityKind.parse(old)).toBe(now);
    for (const kind of ["planned", "pending", "transit"]) expect(StoredActivityKind.parse(kind)).toBe(kind);
    // Not a free-for-all: anything else is still refused.
    expect(StoredActivityKind.safeParse("considering").success).toBe(false);
    expect(StoredActivityKind.safeParse("Booked").success).toBe(false);
    // An own-property check, so a key off Object.prototype is not a kind.
    expect(StoredActivityKind.safeParse("toString").success).toBe(false);
  });

  it("replays an event written before M28", () => {
    const event = ActivityAddedV1.parse({
      type: "ActivityAdded",
      version: 1,
      payload: { tripId: TRIP, activityId: A1, dayId: null, title: "Den", timeWindow: null, location: null, notes: null, kind: "hold" },
    });
    expect(event.payload.kind).toBe("pending");
  });

  it("reads a trip_details row and a saved stop written before M28", () => {
    const view = ActivityView.parse({
      activityId: A1, title: "Den", timeWindow: null, location: null, notes: null, anchors: [], kind: "booked", tags: [], cost: null,
    });
    expect(view.kind).toBe("planned");
    const stop = SavedStop.parse({
      title: "Den", timeWindow: null, location: null, notes: null, anchors: [], kind: "idea", tags: [], cost: null, dayIndex: 0,
    });
    expect(stop.kind).toBe("pending");
  });

  // A command is never stored, so a retired kind on one is a caller that has
  // not moved. Refusing it is what tells that caller.
  it("refuses a retired kind on a command", () => {
    for (const kind of ["idea", "hold", "booked"]) {
      const result = TripCommand.safeParse({ type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den", kind });
      expect(result.success, kind).toBe(false);
    }
  });

  // The manifest reads an enum's values off the schema. `StoredActivityKind`
  // wraps the enum in a preprocess, which `unwrapSchema` has to see through or
  // `stop.kind` is published with no values at all.
  it("publishes stop.kind with the three values", () => {
    const kind = buildAttributeManifest().find((e) => e.kind === "value" && e.object === "stop" && e.field === "kind");
    expect(kind).toMatchObject({ valueKind: "enum", values: ["planned", "pending", "transit"] });
  });
});

describe("a page filtered to a retired kind is filtered to its replacement (v3 → v4)", () => {
  const widget = (name: string, params: Record<string, unknown>) => ({ type: "macro", attrs: { name, params } });

  it("rewrites the kind param of a widget at every depth, and leaves every other param alone", () => {
    const v3 = PageDoc.parse({
      v: 3,
      type: "doc",
      content: [
        widget("stop.rows", { kind: "booked", day: { kind: "index", index: 2 } }),
        { type: "paragraph", content: [{ type: "text", text: "Ideas: " }, widget("count", { kind: "idea", tag: "meal" })] },
        { type: "repeat", attrs: { name: "stop.rows", params: { kind: "hold", template: "{title}" } }, content: [] },
        widget("stop.rows", { kind: "transit" }),
        widget("cost", {}),
      ],
    });
    const migrated = migratePageDoc(v3);
    expect(migrated.v).toBeGreaterThanOrEqual(4);
    expect(migrated.content).toEqual([
      widget("stop.rows", { kind: "planned", day: { kind: "index", index: 2 } }),
      { type: "paragraph", content: [{ type: "text", text: "Ideas: " }, widget("count", { kind: "pending", tag: "meal" })] },
      { type: "repeat", attrs: { name: "stop.rows", params: { kind: "pending", template: "{title}" } }, content: [] },
      widget("stop.rows", { kind: "transit" }),
      widget("cost", {}),
    ]);
  });
});
