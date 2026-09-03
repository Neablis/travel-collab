import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CURRENT_PAGE_DOC_VERSION,
  PAGE_DOC_MIGRATIONS,
  PageContent,
  PageDoc,
  migratePageDoc,
  parsePageDoc,
  serializePageDoc,
} from "../src";
import { PAGE_DOC_V1_GOLDEN } from "./fixtures/pageDocV1";

// Restated here on purpose rather than imported: the generator's job is to
// produce types the parser does NOT know, and sharing the parser's own set
// would make the property agree with the code by construction.
const KNOWN_TYPES = ["doc", "paragraph", "heading", "macro", "repeat", "text"];

// The witness. A round-trip property that only ever saw `{ type: "x" }` would
// pass while proving nothing about the nested payload that is what actually
// gets lost, so count the cases that carried real structure and assert a floor.
// Measured, not guessed: 300 runs put 271, 272, 273, 275 and 277 of them
// through this branch across five sampling runs (2026-09-03). 220 sits far
// enough below that not to flap and far enough above zero to catch a generator
// that stopped generating.
const WITNESS_FLOOR = 220;

const unknownNodeArb = fc
  .tuple(
    fc.string({ minLength: 1 }).filter((type) => !KNOWN_TYPES.includes(type)),
    fc.dictionary(fc.string(), fc.jsonValue(), { maxKeys: 4 }),
  )
  .map(([type, rest]) => ({ ...rest, type }));

function hasNestedContainer(node: Record<string, unknown>): boolean {
  return Object.entries(node).some(
    ([key, value]) => key !== "type" && typeof value === "object" && value !== null,
  );
}

describe("PageDoc versions", () => {
  // Deliberately `PageDoc.parse`, not `parsePageDoc`: this pins the INFERENCE
  // ("a row with no `v` is v1"), not the current version. Asserting it through
  // the migrating reader would make this test start failing the day a v2 lands,
  // for a reason that has nothing to do with what it is checking.
  it("reads a document with no v as v1", () => {
    expect(PageDoc.parse({ type: "doc", content: [] }).v).toBe(1);
  });

  it("derives the current version from the migration chain", () => {
    expect(CURRENT_PAGE_DOC_VERSION).toBe(PAGE_DOC_MIGRATIONS.length + 1);
  });

  it("migrates a v1 document to the current version", () => {
    expect(parsePageDoc(PAGE_DOC_V1_GOLDEN).v).toBe(CURRENT_PAGE_DOC_VERSION);
  });

  it("applies migrations idempotently", () => {
    const once = parsePageDoc(PAGE_DOC_V1_GOLDEN);
    const twice = migratePageDoc(once);
    expect(twice).toEqual(once);
    expect(migratePageDoc(twice)).toEqual(once);
  });

  it("refuses a document written by a newer version instead of guessing at it", () => {
    const future = { ...PageDoc.parse({ type: "doc", content: [] }), v: CURRENT_PAGE_DOC_VERSION + 1 };
    expect(() => migratePageDoc(future)).toThrow(
      new RegExp(`understands up to v${CURRENT_PAGE_DOC_VERSION}`),
    );
  });
});

describe("unknown nodes are carried, never dropped (ADR-038 decision 3)", () => {
  it("wraps a node type this build does not know and puts it back verbatim", () => {
    const stored = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "written by the user" }] },
        { type: "timeline", attrs: { zoom: "week" }, content: [] },
      ],
    };
    const doc = parsePageDoc(stored);
    expect(doc.content[1]).toEqual({ type: "unknown", raw: stored.content[1] });
    expect((serializePageDoc(doc) as { content: unknown[] }).content[1]).toBe(stored.content[1]);
  });

  it("carries an unknown INLINE node inside a paragraph", () => {
    const stored = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "mention", attrs: { userId: "u-1" } }] }],
    };
    const roundTripped = serializePageDoc(parsePageDoc(stored)) as { content: { content: unknown[] }[] };
    expect(roundTripped.content[0]!.content[0]).toEqual({ type: "mention", attrs: { userId: "u-1" } });
  });

  it("round-trips any unknown node byte-identically", () => {
    let nestedWitness = 0;
    fc.assert(
      fc.property(fc.array(unknownNodeArb, { minLength: 1, maxLength: 5 }), (nodes) => {
        if (nodes.some(hasNestedContainer)) nestedWitness += 1;
        const stored = { type: "doc", content: nodes };
        const serialized = serializePageDoc(parsePageDoc(stored)) as { content: unknown[] };
        expect(JSON.stringify(serialized.content)).toBe(JSON.stringify(stored.content));
      }),
      { numRuns: 300 },
    );
    expect(nestedWitness).toBeGreaterThanOrEqual(WITNESS_FLOOR);
  });
});

describe("a malformed node is rejected, not coerced (ADR-038 decision 4)", () => {
  // Each of these is accepted today by `PageContent`'s `z.array(z.unknown())`.
  // That is the point of the change, so the contrast is asserted rather than
  // described: the same input, both schemas.
  const rejected: [string, unknown][] = [
    ["a heading above level 3", { type: "heading", attrs: { level: 4 }, content: [] }],
    ["a heading at a level no editor offers", { type: "heading", attrs: { level: 9 }, content: [] }],
    ["a heading with no level at all", { type: "heading", content: [] }],
    ["an unexpected key inside a widget's attrs", { type: "macro", attrs: { name: "cost.trip", params: {}, day: 2 } }],
    ["a widget with an empty name", { type: "macro", attrs: { name: "", params: {} } }],
    ["a widget whose params are not an object", { type: "macro", attrs: { name: "cost.trip", params: 7 } }],
    ["a text node where a block belongs", { type: "text", text: "loose" }],
    ["a node that is not an object", "just a string"],
    ["a node with no type", { attrs: { level: 1 } }],
  ];

  it.each(rejected)("rejects %s", (_label, node) => {
    expect(() => parsePageDoc({ type: "doc", content: [node] })).toThrow();
    expect(PageContent.safeParse({ type: "doc", content: [node] }).success).toBe(true);
  });

  it("rejects a malformed inline node inside a paragraph", () => {
    expect(() => parsePageDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text" }] }] })).toThrow();
  });

  it("rejects an unknown key on the document itself", () => {
    expect(() => parsePageDoc({ type: "doc", content: [], meta: { author: "someone" } })).toThrow();
  });
});

describe("the v1 golden document", () => {
  it("classifies every v1 node type as itself, and only the newer one as unknown", () => {
    const doc = parsePageDoc(PAGE_DOC_V1_GOLDEN);
    expect(doc.content.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "macro",
      "heading",
      "paragraph",
      "paragraph",
      "repeat",
      "unknown",
    ]);
  });

  it("keeps the newer node it does not understand byte-identical through a round trip", () => {
    const stored = PAGE_DOC_V1_GOLDEN as { content: unknown[] };
    const newer = stored.content.length - 1; // the fixture's last node is the one from a newer build
    const roundTripped = serializePageDoc(parsePageDoc(PAGE_DOC_V1_GOLDEN)) as { content: unknown[] };
    expect(JSON.stringify(roundTripped.content[newer])).toBe(JSON.stringify(stored.content[newer]));
  });

  it("re-serialises to a stable document: round-tripping twice changes nothing", () => {
    const once = serializePageDoc(parsePageDoc(PAGE_DOC_V1_GOLDEN));
    const twice = serializePageDoc(parsePageDoc(once));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
