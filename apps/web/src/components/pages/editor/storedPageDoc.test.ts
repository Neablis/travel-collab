import { describe, expect, it } from "vitest";
import { CURRENT_PAGE_DOC_VERSION, newPageDoc, parsePageDoc, serializePageDoc } from "@tc/contracts";
import { PAGE_EDITOR_NODE_TYPES } from "./extensions";
import { inspectStoredPageDoc, toStoredPageDoc } from "./storedPageDoc";

// The premise every test below rests on, asserted rather than assumed. The
// editor's schema and the AST disagreed about `repeat` until M14 link 6 gave
// the editor a `repeat` extension; that disagreement is what this module was
// written for, and a node from a NEWER build is the same disagreement today.
describe("the editor's schema, as the guard sees it", () => {
  it("knows the nodes StarterKit and MacroNodeExtension bring", () => {
    for (const type of ["paragraph", "heading", "bulletList", "listItem", "codeBlock", "hardBreak", "macro"]) {
      expect(PAGE_EDITOR_NODE_TYPES.has(type)).toBe(true);
    }
  });

  it("knows every node type the AST does, `repeat` included", () => {
    // So a document this build wrote always mounts in this build: every type
    // the guard can still refuse comes from a newer build, never from ours.
    const ast = ["paragraph", "heading", "macro", "repeat", "text", "blockquote", "bulletList", "orderedList", "listItem", "codeBlock", "horizontalRule", "hardBreak"];
    expect(ast.filter((type) => !PAGE_EDITOR_NODE_TYPES.has(type))).toEqual([]);
  });
});

describe("inspectStoredPageDoc", () => {
  // ────────────────────────────────────────────────────────────────────────
  // The headline. ADR-038 decision 4 says to decide read-only by round trip.
  // This document round-trips PERFECTLY and would still cost its owner the
  // page, so the test asserts both halves in one place: the criterion the ADR
  // specified passes, and the guard refuses anyway.
  // ────────────────────────────────────────────────────────────────────────
  it("refuses a document the round-trip criterion says is fine", () => {
    // At the CURRENT version, so the round trip below is about the serialiser
    // and nothing else. A v1 document would also be migrated by `parsePageDoc`
    // (ADR-039 renamed the widgets), and the comparison would then be measuring
    // the migration rather than the criterion this test is about.
    const stored = {
      v: CURRENT_PAGE_DOC_VERSION,
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "written by the user" }] },
        // A `repeat` until the editor learned one (M14 link 6); a node from a
        // newer build is the case left, and it round-trips just as perfectly.
        { type: "callout", attrs: { tone: "warm" }, content: [] },
      ],
    };

    // Decision 4 as written, run literally: parse, re-serialise, compare.
    expect(JSON.stringify(serializePageDoc(parsePageDoc(stored)))).toBe(JSON.stringify(stored));

    // And the editor would still discard every node in it, the user's own
    // paragraph included (PageEditor.test.tsx measures that directly).
    const verdict = inspectStoredPageDoc(stored);
    expect(verdict.status).toBe("unsupported");
    expect(verdict.status === "unsupported" && verdict.unsupportedTypes).toEqual(["callout"]);
  });

  it("mounts a document holding an authored repeat, its sentence in its params", () => {
    const verdict = inspectStoredPageDoc({
      v: CURRENT_PAGE_DOC_VERSION,
      type: "doc",
      content: [{ type: "repeat", attrs: { name: "day.rows", params: { template: "Day {date}" } }, content: [] }],
    });
    expect(verdict.status).toBe("mountable");
  });

  // The preview database holds v2 repeats whose sentence is inline content;
  // the editor's repeat is a leaf now (PR #221 preview), so they mount only
  // because migrate-on-read moved the sentence into `params.template`.
  const writtenRepeat = {
    type: "repeat",
    attrs: { name: "day.rows", params: {} },
    content: [{ type: "text", text: "Day " }, { type: "macro", attrs: { name: "dates", params: {} } }],
  };

  it("mounts a v2 repeat by migrating its sentence into its template", () => {
    const verdict = inspectStoredPageDoc({ v: 2, type: "doc", content: [writtenRepeat] });
    expect(verdict.status).toBe("mountable");
    expect(verdict.status === "mountable" && verdict.doc.content[0]).toEqual({
      type: "repeat",
      attrs: { name: "day.rows", params: { template: "Day {date}" } },
      content: [],
    });
  });

  it("refuses to mount a repeat still holding content in a document no migration will touch", () => {
    const verdict = inspectStoredPageDoc({
      v: CURRENT_PAGE_DOC_VERSION,
      type: "doc",
      content: [{ type: "blockquote", content: [writtenRepeat] }],
    });
    expect(verdict.status === "unsupported" && verdict.unsupportedTypes).toEqual(["repeat"]);
  });

  it("refuses an unsupported node however deeply it is buried", () => {
    const verdict = inspectStoredPageDoc({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "blockquote", content: [{ type: "callout", content: [] }] }],
            },
          ],
        },
      ],
    });
    expect(verdict.status).toBe("unsupported");
  });

  it("mounts an ordinary document, and hands back the parsed AST rather than the raw JSON", () => {
    const verdict = inspectStoredPageDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    });
    expect(verdict.status).toBe("mountable");
    // Parsed AND migrated, so `v` is materialised at the version this build
    // speaks — the caller passes this straight to the editor and must not be
    // handed something that still needs a parse or a migration.
    expect(verdict.status === "mountable" && verdict.doc.v).toBe(CURRENT_PAGE_DOC_VERSION);
  });

  it("mounts every node type the v1 vocabulary has an extension for", () => {
    const verdict = inspectStoredPageDoc({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "h" }] },
        { type: "paragraph", content: [{ type: "macro", attrs: { name: "cost", params: {} } }, { type: "hardBreak" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [] }] }] },
        { type: "orderedList", attrs: { start: 3, type: null }, content: [] },
        { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "x" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [] }] },
        { type: "horizontalRule" },
      ],
    });
    // A false `unsupported` is not a safe failure: it makes an ordinary
    // notebook uneditable, which is the cost ADR-038 weighed against losing one.
    expect(verdict.status).toBe("mountable");
  });

  it("calls a malformed known node unreadable rather than unsupported", () => {
    // A heading at level 9 is not a node from the future — it is a broken
    // heading, and calling it `unknown` would freeze it into the document
    // forever under the banner of forward compatibility.
    const verdict = inspectStoredPageDoc({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 9 }, content: [] }],
    });
    expect(verdict.status).toBe("unreadable");
  });

  it("calls a document from a future version unreadable", () => {
    const verdict = inspectStoredPageDoc({ v: CURRENT_PAGE_DOC_VERSION + 1, type: "doc", content: [] });
    expect(verdict.status).toBe("unreadable");
    expect(verdict.status === "unreadable" && verdict.message).toContain(`v${CURRENT_PAGE_DOC_VERSION + 1}`);
  });

  it("calls something that is not a document at all unreadable", () => {
    expect(inspectStoredPageDoc({ type: "paragraph" }).status).toBe("unreadable");
    expect(inspectStoredPageDoc(null).status).toBe("unreadable");
  });
});

describe("toStoredPageDoc", () => {
  it("stamps the current version onto a document the editor produced without one", () => {
    // `editor.getJSON()` has never heard of `v`. Decision 2 says every save
    // carries one, so this is where it is added.
    const stored = toStoredPageDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "typed" }] }],
    });
    expect(stored).toEqual(newPageDoc([{ type: "paragraph", content: [{ type: "text", text: "typed" }] }]));
    expect(stored?.v).toBe(CURRENT_PAGE_DOC_VERSION);
  });

  it("keeps a document already at the current version there", () => {
    expect(toStoredPageDoc({ v: CURRENT_PAGE_DOC_VERSION, type: "doc", content: [] })?.v).toBe(
      CURRENT_PAGE_DOC_VERSION,
    );
  });

  it("writes a migrated v1 document back at the version it was migrated TO", () => {
    // "We write only what we would open", and what we opened is the migrated
    // document. Writing it back stamped v1 would label v2 content as v1 — the
    // next read would run the migration over already-migrated names, and the
    // row would never leave v1 however many times it was saved.
    const stored = toStoredPageDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "macro", attrs: { name: "cost.trip", params: {} } }] }],
    });
    expect(stored?.v).toBe(CURRENT_PAGE_DOC_VERSION);
    expect(JSON.stringify(stored)).toContain('"cost"');
    expect(JSON.stringify(stored)).not.toContain("cost.trip");
  });

  it("refuses a document it would not have opened, so the two rules cannot diverge", () => {
    // "We write only what we would open." Unreachable from `PageScreen` — a
    // document with a newer build's node in it is read-only, so nothing calls
    // this for one — and that is exactly why it is asserted here rather than
    // left to the call site to maintain.
    expect(
      toStoredPageDoc({
        type: "doc",
        content: [{ type: "callout", content: [] }],
      }),
    ).toBeNull();
  });

  it("refuses to produce anything for a document it cannot parse", () => {
    // The caller's contract: `null` means do not write. Returning the input
    // unchanged here would put an unparseable document on the wire, which is
    // the failure the write path was tightened to stop.
    expect(toStoredPageDoc({ type: "doc", content: [{ type: "heading", attrs: { level: 9 }, content: [] }] })).toBeNull();
    expect(toStoredPageDoc("not a document")).toBeNull();
  });
});

// The hole this closes was in the guard itself, found by re-reading it rather
// than by a failing test: `doc` is a node type in the editor's schema, so a
// stored document with a `doc` nested in its content read as `mountable` — and
// TipTap discards the whole page for it, which is the one outcome this module
// exists to prevent. It is not a parse error on the way in either: `PageDoc`
// wraps an unrecognised type as an unknown node, and the collector reports it
// by the type it wrapped.
describe("the top node, which is a node type but never a content node", () => {
  it("is not in the set the guard compares against", () => {
    expect(PAGE_EDITOR_NODE_TYPES.has("doc")).toBe(false);
  });

  it("refuses a document with a `doc` node nested in its content", () => {
    const verdict = inspectStoredPageDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [] }, { type: "doc", content: [] }],
    });
    expect(verdict.status).toBe("unsupported");
    expect(verdict.status === "unsupported" && verdict.unsupportedTypes).toEqual(["doc"]);
  });
});
