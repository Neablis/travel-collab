import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CURRENT_PAGE_DOC_VERSION,
  FIELD_CHANGES,
  PAGE_DOC_MIGRATIONS,
  type FieldChange,
  WIDGET_NAME_MIGRATION,
  PageContent,
  PageDoc,
  SentenceTemplate,
  collectPageDocNodeTypes,
  migratePageDoc,
  pageDocMigrations,
  parsePageDoc,
  serializePageDoc,
} from "../src";
import { PAGE_DOC_V1_GOLDEN } from "./fixtures/pageDocV1";
import { PAGE_DOC_V2_GOLDEN } from "./fixtures/pageDocV2";

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
  // **The v2 golden, not the v1 one.** These assert byte-identity through
  // parse-and-serialise, and `parsePageDoc` also MIGRATES — so run against a v1
  // document they were really asserting "the migration changes nothing", which
  // is false by design now that a migration exists and was the shape of the
  // failure when ADR-039's v1→v2 step landed. The migration has its own
  // describe below; this one is about the serialiser.
  //
  // Not the whole document: an empty `{ type: "paragraph" }` canonicalises to
  // `content: []` by design, so byte-identity is a per-node promise, never a
  // per-document one.
  const goldenNode = (type: string): unknown => {
    const stored = PAGE_DOC_V2_GOLDEN as { content: { type: string }[] };
    const index = stored.content.findIndex((node) => node.type === type);
    expect(index).toBeGreaterThanOrEqual(0);
    return stored.content[index];
  };
  const roundTrippedNode = (type: string): unknown => {
    const stored = PAGE_DOC_V2_GOLDEN as { content: { type: string }[] };
    const index = stored.content.findIndex((node) => node.type === type);
    return (serializePageDoc(parsePageDoc(PAGE_DOC_V2_GOLDEN)) as { content: unknown[] }).content[index];
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
    // Still the v1 golden, deliberately: the second pass is where a migration
    // that is not idempotent shows up, and it is a v1 row that has one to run.
    const once = serializePageDoc(parsePageDoc(PAGE_DOC_V1_GOLDEN));
    const twice = serializePageDoc(parsePageDoc(once));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

// **ADR-039 decision 9: one migration, once.** Seventeen widget names become
// eleven primitives with their filters; the preset a person picks is data and
// is never stored, so retiring one migrates nothing. This is the whole cost of
// the vocabulary change to stored documents, and it is one function.
describe("v1 → v2: the widget names become primitives (ADR-039)", () => {
  const migrated = () => serializePageDoc(parsePageDoc(PAGE_DOC_V1_GOLDEN));

  it("turns the whole v1 golden into the v2 golden, at every depth", () => {
    // The strongest form available: two hand-written documents, one migration
    // between them. It covers the widget in a paragraph, the widget as a block,
    // the `repeat` node's own attrs, and the widget two lists down — the depth
    // at which a walk that stopped recursing would quietly leave a stale name.
    expect(migrated()).toEqual(serializePageDoc(parsePageDoc(PAGE_DOC_V2_GOLDEN)));
  });

  it("carries a day binding across the rename rather than dropping it", () => {
    // `itinerary.day` spelled its binding `dayRef`; `day.detail` spells it
    // `day`. A migration that renamed the widget and not the key would leave
    // every dated page pointed at nothing — and, because an absent filter now
    // means EVERY day (ADR-039 decision 2), it would silently widen a page
    // about day 3 into a page about the whole trip rather than break loudly.
    const doc = parsePageDoc({
      type: "doc",
      content: [
        { type: "macro", attrs: { name: "itinerary.day", params: { dayRef: { kind: "index", index: 2 } } } },
      ],
    });
    expect(doc.content[0]).toEqual({
      type: "macro",
      attrs: { name: "day.detail", params: { day: { kind: "index", index: 2 } } },
    });
  });

  it("turns a name that WAS a filter into that filter", () => {
    // "A line for every booking" was a widget; booking is `kind: "booked"`, an
    // enum member that already existed. The name carried the filter, so the
    // migration has to write it down or the page starts listing every stop.
    const doc = parsePageDoc({
      type: "doc",
      content: [
        { type: "macro", attrs: { name: "booking.line", params: { dayRef: { kind: "index", index: 1 } } } },
      ],
    });
    expect(doc.content[0]).toEqual({
      type: "macro",
      attrs: { name: "stop.rows", params: { day: { kind: "index", index: 1 }, kind: "booked" } },
    });
  });

  it("lets the RENAMED key win over a stray param already using its new name", () => {
    // A hand-edited v1 node carrying both `dayRef` and `day`. Only `dayRef`
    // meant anything at v1, so it has to win — and it has to win regardless of
    // which key JSON iteration reaches last, which a single-pass rename does
    // not guarantee (Copilot, PR 141).
    const day2 = { kind: "index", index: 1 };
    const day5 = { kind: "index", index: 4 };
    for (const params of [
      { dayRef: day2, day: day5 },
      { day: day5, dayRef: day2 },
    ]) {
      const doc = parsePageDoc({
        type: "doc",
        content: [{ type: "macro", attrs: { name: "cost.day", params } }],
      });
      expect(doc.content[0], JSON.stringify(params)).toEqual({
        type: "macro",
        attrs: { name: "cost", params: { day: day2 } },
      });
    }
  });

  it("lets the name's own filter win over a stray param of the same key", () => {
    // A hand-edited document could carry `kind: "idea"` under `booking.line`,
    // where it meant nothing at all to the old resolver. It must not start
    // meaning something under the new one.
    const doc = parsePageDoc({
      type: "doc",
      content: [{ type: "macro", attrs: { name: "booking.line", params: { kind: "idea" } } }],
    });
    expect(doc.content[0]).toMatchObject({ attrs: { params: { kind: "booked" } } });
  });

  it("leaves a name it does not recognise alone", () => {
    // Carry, don't drop (decision 3), applied to a NAME rather than a node
    // type: it is either a widget from a newer build or one already migrated,
    // and rewriting it would be guessing. `MacroView` has a legible answer for
    // a name the registry cannot resolve.
    const doc = parsePageDoc({
      type: "doc",
      content: [{ type: "macro", attrs: { name: "weather.tomorrow", params: { city: "Kyoto" } } }],
    });
    expect(doc.content[0]).toEqual({
      type: "macro",
      attrs: { name: "weather.tomorrow", params: { city: "Kyoto" } },
    });
  });

  it("covers all seventeen names, and lands each on a primitive", () => {
    // Non-vacuous, and it is the count that matters: ADR-039 opens by saying
    // the registry holds seventeen widgets. A migration table that quietly
    // covered fifteen would leave two pages broken and no test red.
    expect(Object.keys(WIDGET_NAME_MIGRATION)).toHaveLength(17);
    const targets = new Set(Object.values(WIDGET_NAME_MIGRATION).map((step) => step.name));
    // Ten of the twelve primitives. `count` and `city.detail` are the two the
    // seventeen never covered — the cells of the cross product nobody had typed
    // out yet — so nothing migrates to them, and pinning the number is what
    // makes that a stated fact rather than a suspicion about a short table.
    expect([...targets].sort()).toEqual([
      "attribute", "city", "city.rows", "cost", "cost.rows",
      "dates", "day.detail", "day.rows", "hours", "stop.rows",
    ]);
  });
});

// `collectPageDocNodeTypes` exists because ADR-038 decision 4's stated
// criterion cannot answer the question it was written to answer — see
// `apps/web/src/components/pages/editor/storedPageDoc.ts`, which is where the
// comparison this feeds actually happens. These tests cover the half contracts
// owns: does it see every node in the document, and does it name them
// usefully?
describe("collectPageDocNodeTypes", () => {
  it("reaches nodes nested inside lists, list items and blockquotes", () => {
    const doc = parsePageDoc({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [{ type: "codeBlock", content: [{ type: "text", text: "x" }] }] },
              ],
            },
          ],
        },
      ],
    });
    // `codeBlock` is four levels down. A collector that walked only the top
    // level would report `blockquote` and stop, and the guard built on it would
    // mount a document whose deepest node the editor cannot render.
    expect([...collectPageDocNodeTypes(doc)].sort()).toEqual([
      "blockquote",
      "bulletList",
      "codeBlock",
      "listItem",
      "text",
    ]);
  });

  it("names an unknown node by the type it was wrapping, not by the wrapper", () => {
    const doc = parsePageDoc({
      type: "doc",
      content: [{ type: "somethingFromANewerBuild", attrs: {} }],
    });
    // The caller's next move is to tell a person what they cannot edit.
    // `"unknown"` is our word for not knowing, not an answer to that.
    expect([...collectPageDocNodeTypes(doc)]).toEqual(["somethingFromANewerBuild"]);
  });

  it("sees an unknown node buried inside a list item", () => {
    const doc = parsePageDoc({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "alsoNewer" }] }],
        },
      ],
    });
    expect([...collectPageDocNodeTypes(doc)].sort()).toEqual(["alsoNewer", "bulletList", "listItem"]);
  });

  it("finds every node type in the v1 golden", () => {
    const types = collectPageDocNodeTypes(parsePageDoc(PAGE_DOC_V1_GOLDEN));
    // `repeat` is the one that matters: it is a v1 node with no TipTap
    // extension behind it, and it is exactly what the editor-side guard has to
    // notice. `hardBreak` and `macro` are inline, which is the other axis a
    // top-level-only walk would miss.
    for (const type of ["heading", "paragraph", "macro", "repeat", "hardBreak", "text", "codeBlock"]) {
      expect(types.has(type)).toBe(true);
    }
  });
});

// Mitchell's preview comment on PR #221 (2026-09-24): a repeat's sentence is
// one string with `{field}` tokens, edited in the settings panel. Only the
// preview database holds a v2 repeat, and each converts to the closest
// sentence that reads the same.
describe("v2 → v3: a repeat's sentence becomes its template", () => {
  const repeat = (name: string, content: unknown[], params: Record<string, unknown> = {}) => ({
    type: "repeat",
    attrs: { name, params },
    content,
  });
  const text = (t: string) => ({ type: "text", text: t });
  const widget = (name: string, params: Record<string, unknown> = {}) => ({ type: "macro", attrs: { name, params } });
  const migrate = (content: unknown[]) => serializePageDoc(parsePageDoc({ v: 2, type: "doc", content }));

  it("writes each widget as the token that prints what it printed, and every other as its label", () => {
    const doc = migrate([
      repeat("city.rows", [text("Welcome to "), widget("city"), text("!")]),
      repeat("day.rows", [widget("dates"), text(" — "), widget("city"), text(", "), widget("cost")], { dates: { from: "2027-06-01" } }),
      repeat("stop.rows", [widget("field", { field: "stop.title" }), text(" costs "), widget("cost")]),
    ]);
    expect(doc).toEqual({
      v: CURRENT_PAGE_DOC_VERSION,
      type: "doc",
      content: [
        repeat("city.rows", [], { template: "Welcome to {name}!" }),
        // The repeat's own filters are kept beside the sentence.
        repeat("day.rows", [], { dates: { from: "2027-06-01" }, template: "{date} — {cities}, {costSubtotal}" }),
        repeat("stop.rows", [], { template: "{title} costs {cost}" }),
      ],
    });
  });

  it("keeps a bound widget, a widget with no field of the item, and a newer node as plain words", () => {
    const doc = migrate([
      repeat("day.rows", [
        // Bound: it read the day's BOOKED cost, which no day field holds.
        widget("cost", { kind: "booked" }),
        text(" · "),
        // A trip fact is the same on every line: its manifest label.
        widget("attribute", { field: "trip.name" }),
        text(" · "),
        widget("day.weather"),
        { type: "hardBreak" },
        { type: "fromTheFuture", attrs: {} },
        text("end"),
      ]),
    ]) as { content: { attrs: { params: { template: string } } }[] };
    expect(doc.content[0]!.attrs.params.template).toBe("What it costs · The trip's name · Weather end");
  });

  it("writes a line break inside a text node as a space, so the sentence is one line", () => {
    // `PageTextNode` allows "\n" (the API and the assistant write one); a
    // sentence does not, and a template failing its schema locks every save.
    const doc = migrate([repeat("city.rows", [text("Welcome\nto\r\n"), widget("city")])]) as {
      content: { attrs: { params: { template: string } } }[];
    };
    const template = doc.content[0]!.attrs.params.template;
    expect(template).toBe("Welcome to {name}");
    expect(SentenceTemplate.safeParse(template).success).toBe(true);
  });

  it("escapes the author's own braces, so they still print as braces", () => {
    const doc = migrate([repeat("city.rows", [text("{city} or {{x}} "), widget("city")])]) as {
      content: { attrs: { params: { template: string } } }[];
    };
    expect(doc.content[0]!.attrs.params.template).toBe("{{city}} or {{{{x}}}} {name}");
  });

  it("converts a repeat at any depth, and leaves one with no sentence alone", () => {
    const nested = { type: "bulletList", content: [{ type: "listItem", content: [repeat("city.rows", [widget("city")])] }] };
    expect(migrate([nested, repeat("day.rows", [])])).toEqual({
      v: CURRENT_PAGE_DOC_VERSION,
      type: "doc",
      content: [
        { type: "bulletList", content: [{ type: "listItem", content: [repeat("city.rows", [], { template: "{name}" })] }] },
        repeat("day.rows", []),
      ],
    });
  });
});

// M14 field widget, Mitchell's answer 1: a renamed or removed field converts
// the documents that name it, so a stored page never names a field the
// manifest lacks. The real `FIELD_CHANGES` is empty — nothing has been renamed
// — so every case here injects its own table into `pageDocMigrations`, which
// is the same builder the real chain comes from.
describe("a renamed or removed field converts the documents that read it", () => {
  const RENAME: FieldChange = { kind: "rename", from: "stop.cost", to: "stop.price", since: 4 };
  const REMOVE: FieldChange = { kind: "remove", path: "trip.budgetRemaining", label: "Budget left", since: 4 };
  const REMOVE_DAY_COST: FieldChange = { kind: "remove", path: "trip.days.costSubtotal", label: "Day cost", since: 4 };
  const migrations = pageDocMigrations([RENAME, REMOVE, REMOVE_DAY_COST]);
  const v2 = (content: unknown[]) => PageDoc.parse({ v: 2, type: "doc", content });
  const widget = (name: string, params: Record<string, unknown>) => ({ type: "macro", attrs: { name, params } });
  const PLACEHOLDER = { type: "text", text: "(Budget left — no longer available)" };

  it("points a renamed field's widget at the new path, at every depth", () => {
    const cost = widget("field", { field: "stop.cost", day: { kind: "index", index: 1 } });
    const doc = migratePageDoc(
      v2([
        cost,
        { type: "paragraph", content: [{ type: "text", text: "Spent " }, cost] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "blockquote", content: [cost] }] }] },
        { type: "repeat", attrs: { name: "stop.rows", params: { template: "{title}: {cost}" } }, content: [] },
      ]),
      migrations,
    );
    const renamed = widget("field", { field: "stop.price", day: { kind: "index", index: 1 } });
    expect(serializePageDoc(doc)).toEqual({
      v: 4,
      type: "doc",
      content: [
        renamed,
        { type: "paragraph", content: [{ type: "text", text: "Spent " }, renamed] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "blockquote", content: [renamed] }] }] },
        // A sentence names its field by token, and the token follows the field.
        { type: "repeat", attrs: { name: "stop.rows", params: { template: "{title}: {price}" } }, content: [] },
      ],
    });
  });

  it("turns a token whose field moved out of the item's fields into plain words, not a dead token", () => {
    // A day's `cities` renamed onto the trip: no day token reaches it, so the
    // sentence says the words instead of printing "{cities}" on every line.
    const moved = pageDocMigrations([{ kind: "rename", from: "trip.days.cities", to: "trip.dayCities", since: 4 }]);
    const doc = migratePageDoc(
      v2([{ type: "repeat", attrs: { name: "day.rows", params: { template: "{date}: {cities}" } }, content: [] }]),
      moved,
    );
    expect((serializePageDoc(doc) as { content: unknown[] }).content).toEqual([
      { type: "repeat", attrs: { name: "day.rows", params: { template: "{date}: cities" } }, content: [] },
    ]);
  });

  it("turns a removed field's widget into text naming the old field, not nothing", () => {
    // Four more calls, item 4: a placeholder, never a silent drop. A widget at
    // block position becomes a paragraph, because a bare text node is not a
    // block; a sentence's token becomes the field's label, as text.
    const budget = widget("attribute", { field: "trip.budgetRemaining" });
    const doc = migratePageDoc(
      v2([
        budget,
        { type: "paragraph", content: [{ type: "text", text: "Left: " }, budget] },
        { type: "repeat", attrs: { name: "day.rows", params: { template: "{date} {{cost}}: {costSubtotal}" } }, content: [] },
      ]),
      migrations,
    );
    expect(serializePageDoc(doc)).toEqual({
      v: 4,
      type: "doc",
      content: [
        { type: "paragraph", content: [PLACEHOLDER] },
        { type: "paragraph", content: [{ type: "text", text: "Left: " }, PLACEHOLDER] },
        { type: "repeat", attrs: { name: "day.rows", params: { template: "{date} {{cost}}: Day cost" } }, content: [] },
      ],
    });
  });

  it("renames a field in a list of columns, and drops a removed one from it", () => {
    // A column is not a widget: the table around it still has everything else
    // the author picked, so only the removed column goes.
    const doc = migratePageDoc(
      v2([widget("stop.rows", { columns: ["stop.title", "stop.cost", "trip.budgetRemaining"], kind: "booked" })]),
      migrations,
    );
    expect(doc.content).toEqual([widget("stop.rows", { columns: ["stop.title", "stop.price"], kind: "booked" })]);
  });

  it("leaves widgets on other fields, and widgets with no field, as they were", () => {
    const content = [
      widget("attribute", { field: "trip.name" }),
      widget("cost", { day: { kind: "index", index: 0 } }),
      // A field param that is not a string is not a path this table can match.
      widget("field", { field: { object: "stop" } }),
    ];
    expect(serializePageDoc(migratePageDoc(v2(content), migrations))).toEqual({ v: 4, type: "doc", content });
  });

  it("applies batches in order, so a field can be renamed twice", () => {
    const chain = pageDocMigrations([
      { kind: "rename", from: "stop.cost", to: "stop.price", since: 4 },
      { kind: "rename", from: "stop.price", to: "stop.amount", since: 5 },
    ]);
    // A page written at v3 takes both steps; one written at v4 already says
    // `stop.price` and takes only the second.
    for (const [v, field] of [[3, "stop.cost"], [4, "stop.price"]] as const) {
      const doc = migratePageDoc(PageDoc.parse({ v, type: "doc", content: [widget("field", { field })] }), chain);
      expect(doc, `from v${v}`).toEqual({ v: 5, type: "doc", content: [widget("field", { field: "stop.amount" })] });
    }
  });

  it("bumps the version once per batch, not once per entry", () => {
    // Three entries, two batches: two new versions.
    const chain = pageDocMigrations([RENAME, REMOVE, { kind: "rename", from: "trip.name", to: "trip.title", since: 5 }]);
    expect(chain.length).toBe(pageDocMigrations([]).length + 2);
    // The real table follows the same rule.
    expect(CURRENT_PAGE_DOC_VERSION).toBe(3 + new Set(FIELD_CHANGES.map((change) => change.since)).size);
  });

  it("refuses a table whose batches do not follow on from the chain before them", () => {
    // A batch at v5 with no v4 would leave v4 undefined; one at v3 would join
    // a version that already shipped, which a v3 document never runs again.
    expect(() => pageDocMigrations([{ ...RENAME, since: 5 }])).toThrow(/since 4/);
    expect(() => pageDocMigrations([{ ...RENAME, since: 3 }])).toThrow(/since 4/);
  });

  it("still instantiates a template snapshotted before the field moved", () => {
    // ADR-038 and the M14 gate box: a saved template (link 10) is a stored
    // document version, so it arrives as JSON at its old `v` and goes through
    // the same migrate-on-read as a page. This is that journey, end to end.
    const snapshot: unknown = JSON.parse(
      JSON.stringify(serializePageDoc(v2([{ type: "paragraph", content: [widget("field", { field: "stop.cost" })] }]))),
    );
    const instantiated = migratePageDoc(PageDoc.parse(snapshot), migrations);
    expect(instantiated.content).toEqual([{ type: "paragraph", content: [widget("field", { field: "stop.price" })] }]);
    // Saved again, it is a current document, and a second read changes nothing.
    expect(migratePageDoc(PageDoc.parse(serializePageDoc(instantiated)), migrations)).toEqual(instantiated);
  });
});
