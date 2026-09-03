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
// would make the property agree with the code by construction. Restating it
// costs exactly this — the list has to be widened by hand whenever the
// vocabulary is, as it was on 2026-09-03.
const KNOWN_TYPES = [
  "doc",
  "paragraph",
  "heading",
  "macro",
  "repeat",
  "text",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
];

// The witness. A round-trip property that only ever saw `{ type: "x" }` would
// pass while proving nothing about the nested payload that is what actually
// gets lost, so count the cases that carried real structure and assert a floor.
// Measured, not guessed: 300 runs put 271, 272, 273, 275 and 277 of them
// through this branch across five sampling runs (2026-09-03). 220 sits far
// enough below that not to flap and far enough above zero to catch a generator
// that stopped generating.
//
// Re-measured the same day, after the vocabulary widened and `KNOWN_TYPES`
// below grew with it: 265, 270, 272, 277, 283, 283 over six runs. The floor
// still fits, which is the answer only because it was measured again — a
// filter that now excludes twice as many type names could have moved it.
const WITNESS_FLOOR = 220;

// The recursive counterpart, and it needs its own floor: the interesting cases
// are the ones nested deeply enough that a serialiser walking one level would
// have stopped. Measured over six runs of 300 (2026-09-03): 141, 155, 155, 157,
// 158, 160. 110 is the same kind of margin as above.
const NESTED_WITNESS_FLOOR = 110;

const unknownNodeArb = fc
  .tuple(
    fc.string({ minLength: 1 }).filter((type) => !KNOWN_TYPES.includes(type)),
    fc.dictionary(fc.string(), fc.jsonValue(), { maxKeys: 4 }),
  )
  .map(([type, rest]) => ({ ...rest, type }));

// bulletList → listItem → … → the node. Every wrapper is a known type with an
// explicit `content` array, so the whole thing is byte-stable and any
// difference in the round trip belongs to the node at the bottom.
function buryInLists(node: unknown, depth: number): unknown {
  let buried = node;
  for (let level = 0; level < depth; level += 1) {
    buried = { type: "bulletList", content: [{ type: "listItem", content: [buried] }] };
  }
  return buried;
}

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

  // The same promise, made where the recursion could quietly stop keeping it.
  // A list holds list items which hold blocks which hold lists, so "unknown
  // nodes come back verbatim" has to be true at every depth, not just the top.
  it("round-trips an unknown node verbatim however deeply a list buries it", () => {
    let deepWitness = 0;
    fc.assert(
      fc.property(unknownNodeArb, fc.integer({ min: 1, max: 4 }), (node, depth) => {
        if (depth >= 2 && hasNestedContainer(node)) deepWitness += 1;
        const buried = buryInLists(node, depth);
        const stored = { type: "doc", content: [buried] };
        const serialized = serializePageDoc(parsePageDoc(stored)) as { content: unknown[] };
        expect(JSON.stringify(serialized.content[0])).toBe(JSON.stringify(buried));
      }),
      { numRuns: 300 },
    );
    expect(deepWitness).toBeGreaterThanOrEqual(NESTED_WITNESS_FLOOR);
  });
});

describe("the v1 vocabulary is the editor's vocabulary (ADR-038, amended 2026-09-03)", () => {
  // Every shape below was copied out of a real `editor.getJSON()` — an editor
  // built with `PageEditor`'s own `[StarterKit, MacroNodeExtension]` and fed
  // one of each node. That is the only reason to trust the attrs: `orderedList`
  // carries `type` as well as `start`, `codeBlock` carries `language: null`
  // when it has none, and `horizontalRule`/`hardBreak` carry no `attrs` key at
  // all. A node that stops parsing here is a page that opens read-only.
  const emitted: [string, unknown][] = [
    ["bulletList", { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] }],
    ["orderedList", { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [] }] }] }],
    ["blockquote", { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }] }],
    ["codeBlock", { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const x = 1;" }] }],
    ["horizontalRule", { type: "horizontalRule" }],
  ];

  it.each(emitted)("parses %s as itself rather than as an unknown node", (type, node) => {
    expect(parsePageDoc({ type: "doc", content: [node] }).content[0]!.type).toBe(type);
  });

  it("parses a heading at every level StarterKit and pageTools.ts both offer", () => {
    const levels = [1, 2, 3, 4, 5, 6];
    const doc = parsePageDoc({
      type: "doc",
      content: levels.map((level) => ({ type: "heading", attrs: { level }, content: [] })),
    });
    expect(doc.content.map((node) => (node.type === "heading" ? node.attrs.level : null))).toEqual(levels);
  });

  it("puts a hard break INLINE, where the editor puts it", () => {
    const paragraph = {
      type: "paragraph",
      content: [{ type: "text", text: "before" }, { type: "hardBreak" }, { type: "text", text: "after" }],
    };
    const [parsed] = parsePageDoc({ type: "doc", content: [paragraph] }).content;
    expect(parsed!.type === "paragraph" && parsed.content.map((child) => child.type)).toEqual([
      "text",
      "hardBreak",
      "text",
    ]);
    // The other half of the claim: inline means inline. A hard break sitting
    // where a block belongs is a known type in the wrong place.
    expect(() => parsePageDoc({ type: "doc", content: [{ type: "hardBreak" }] })).toThrow();
  });

  it("materialises the attrs TipTap would have written, rather than refusing a node without them", () => {
    const doc = parsePageDoc({
      type: "doc",
      content: [
        { type: "orderedList", content: [] },
        { type: "codeBlock", content: [] },
      ],
    });
    expect(doc.content[0]).toEqual({ type: "orderedList", attrs: { start: 1, type: null }, content: [] });
    expect(doc.content[1]).toEqual({ type: "codeBlock", attrs: { language: null }, content: [] });
  });

  it("keeps a known node out of a position the editor cannot put it in", () => {
    // `listItem` has no ProseMirror group at all — measured — so a list is the
    // only place it is valid.
    expect(() => parsePageDoc({ type: "doc", content: [{ type: "listItem", content: [] }] })).toThrow();
    expect(() =>
      parsePageDoc({ type: "doc", content: [{ type: "bulletList", content: [{ type: "paragraph", content: [] }] }] }),
    ).toThrow();
  });

  it("refuses a mark inside a code block, which the editor's schema forbids", () => {
    const stored = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: null },
          content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }],
        },
      ],
    };
    expect(() => parsePageDoc(stored)).toThrow();
  });
});

describe("the recursive vocabulary round-trips (ADR-038 decisions 3 and 5)", () => {
  // Not the whole document: an empty `{ type: "paragraph" }` canonicalises to
  // `content: []` by design, so byte-identity is a per-node promise, never a
  // per-document one.
  const goldenNode = (type: string): unknown => {
    const stored = PAGE_DOC_V1_GOLDEN as { content: { type: string }[] };
    const index = stored.content.findIndex((node) => node.type === type);
    expect(index).toBeGreaterThanOrEqual(0);
    return stored.content[index];
  };
  const roundTrippedNode = (type: string): unknown => {
    const stored = PAGE_DOC_V1_GOLDEN as { content: { type: string }[] };
    const index = stored.content.findIndex((node) => node.type === type);
    return (serializePageDoc(parsePageDoc(PAGE_DOC_V1_GOLDEN)) as { content: unknown[] }).content[index];
  };

  // bulletList → listItem → bulletList → listItem → { paragraph → macro,
  // an unknown node }. The widget and the unknown node two lists down are
  // what a one-level serialiser loses.
  it("round-trips a list nested two deep, widget and all", () => {
    expect(JSON.stringify(roundTrippedNode("bulletList"))).toBe(JSON.stringify(goldenNode("bulletList")));
  });

  // This one is what actually catches a serialiser that stops recursing: an
  // unknown node comes back as `{ type: "unknown", raw }` rather than as
  // itself, at every depth below where the walk gave up. The golden's
  // blockquote holds one four levels down.
  it("round-trips a blockquote holding a list holding a node from a newer build", () => {
    expect(JSON.stringify(roundTrippedNode("blockquote"))).toBe(JSON.stringify(goldenNode("blockquote")));
  });

  it("round-trips every remaining node of the widened vocabulary byte-identically", () => {
    for (const type of ["orderedList", "codeBlock", "horizontalRule"]) {
      expect(JSON.stringify(roundTrippedNode(type))).toBe(JSON.stringify(goldenNode(type)));
    }
  });

  it("puts an unknown node nested inside a list item back byte-identically", () => {
    const newer = { type: "poll", attrs: { question: "ryokan or hotel?" }, options: ["a", "b"] };
    const stored = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "vote" }] }, newer],
            },
          ],
        },
      ],
    };
    const doc = parsePageDoc(stored);
    const listItem = doc.content[0]!.type === "bulletList" ? doc.content[0].content[0]! : null;
    expect(listItem?.type === "listItem" && listItem.content[1]).toEqual({ type: "unknown", raw: newer });

    const roundTripped = serializePageDoc(doc) as {
      content: { content: { content: unknown[] }[] }[];
    };
    // `toBe`, not `toEqual`: decision 3 promises the ORIGINAL value back, not
    // a re-encoding of it that happens to compare equal.
    expect(roundTripped.content[0]!.content[0]!.content[1]).toBe(newer);
  });

  it("puts an unknown node nested inside a blockquote back byte-identically", () => {
    const newer = { type: "timeline", attrs: { zoom: "week" } };
    const stored = { type: "doc", content: [{ type: "blockquote", content: [newer] }] };
    const roundTripped = serializePageDoc(parsePageDoc(stored)) as { content: { content: unknown[] }[] };
    expect(roundTripped.content[0]!.content[0]).toBe(newer);
  });
});

describe("a malformed node is rejected, not coerced (ADR-038 decision 4)", () => {
  // Each of these is accepted today by `PageContent`'s `z.array(z.unknown())`.
  // That is the point of the change, so the contrast is asserted rather than
  // described: the same input, both schemas.
  const rejected: [string, unknown][] = [
    ["a heading one level above what StarterKit offers", { type: "heading", attrs: { level: 7 }, content: [] }],
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
      "heading",
      "bulletList",
      "orderedList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
      "paragraph",
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
