import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newPageDoc } from "@tc/contracts";
import type { PageDoc } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { DEFAULT_TEMPLATES } from "@tc/pages";
import { PageEditor } from "./PageEditor";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";

afterEach(cleanup);

// jsdom has no layout engine, so ProseMirror's coordinate-based cursor
// placement (`posAtCoords`/`coordsAtPos`, used on every click/mousedown into
// the editor) throws on `elementFromPoint`/`getClientRects`, which don't
// exist in jsdom. Stub both so `userEvent.type`'s click-then-type sequence
// can place a cursor without a real layout — every other browser API stays
// real; only the geometry ProseMirror needs is faked.
beforeEach(() => {
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const detail = tripDetailFixture();
const context = { tripId: detail.tripId };

describe("PageEditor", () => {
  it("offers no macro autocomplete", async () => {
    render(
      <PageEditor
        detail={detail}
        context={context}
        value={newPageDoc([{ type: "paragraph", content: [] }])}
        onChange={() => {}}
      />,
    );
    // userEvent's `{` starts a special-key escape sequence (e.g. `{enter}`),
    // so a literal `{` is written `{{` — two literal braces is `{{{{`.
    await userEvent.type(screen.getByRole("textbox"), "{{{{");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("preserves an existing macro node through load and edit", async () => {
    const onChange = vi.fn();
    const content = newPageDoc([
      { type: "paragraph", content: [{ type: "macro", attrs: { name: "cost.trip", params: {} } }] },
      { type: "paragraph", content: [] },
    ]);
    render(<PageEditor detail={detail} context={context} value={content} onChange={onChange} />);

    await userEvent.type(screen.getByRole("textbox"), "hello");

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
    expect(JSON.stringify(lastCall)).toContain('"macro"');
    expect(JSON.stringify(lastCall)).toContain("cost.trip");
  });
});

// ADR-038 asked an open empirical question and refused to design around a guess:
// when a stored page holds a node type the editor's TipTap schema has no
// definition for, does ProseMirror throw or does it drop the node? It does
// neither. `createNodeFromContent` catches ProseMirror's
// `RangeError: Unknown node type: repeat`, warns, and falls back to an EMPTY
// document — so the blast radius is not the unrecognised node, it is every node
// on the page. `PageScreen` then autosaves that empty document over the original
// on its 800 ms debounce, with no error and nothing for the user to see.
//
// This test is the reproduction, and it stays exactly as it is now that
// decision 4 has landed. It does NOT describe a bug any longer: mounting an
// unmountable document is something `PageScreen` no longer does, because
// `inspectStoredPageDoc` refuses first (`storedPageDoc.ts`, and
// `PageScreen.test.tsx` for the refusal from the reader's side). What this
// pins is the REASON that guard is shaped the way it is — TipTap's behaviour,
// which we do not control and which a version bump could change. If it ever
// starts throwing, or starts dropping only the offending node, this goes red
// and the guard's design should be revisited rather than the test updated.
describe("PageEditor given a node type the schema does not know (ADR-038)", () => {
  // A perfectly valid `PageDoc` — `repeat` is in the AST's block union, and the
  // v1 golden contains one. It is the editor that has no extension for it, and
  // that asymmetry is the entire reason `inspectStoredPageDoc` compares against
  // the editor's schema rather than against our own parser (see `storedPageDoc.ts`).
  const withUnknownNode: PageDoc = newPageDoc([
    { type: "paragraph", content: [{ type: "text", text: "written by the user" }] },
    { type: "repeat", attrs: { name: "day.line", params: {} }, content: [] },
  ]);

  it("discards the whole stored document rather than throwing or dropping the one node", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onChange = vi.fn();
    try {
      render(<PageEditor detail={detail} context={context} value={withUnknownNode} onChange={onChange} />);

      await userEvent.type(screen.getByRole("textbox"), "x");

      // Not a throw: the editor mounted and is editable. TipTap swallowed it.
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toContain("[tiptap warn]: Invalid content.");

      expect(onChange).toHaveBeenCalled();
      const saved = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
      // Not a targeted drop either: the user's own paragraph went with it, and
      // what would be written back is the keystroke and nothing else.
      expect(saved).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] });
    } finally {
      warn.mockRestore();
    }
  });
});


// KI-44 regression. `.tc-page-editor` was applied at the call site and defined
// nowhere for the whole life of the Notebook surface, and nothing caught it
// because no test tied the class on the element to a rule in the stylesheet.
// jsdom has no cascade worth trusting (no custom-property substitution, no
// real layout), so this does NOT assert computed pixels — it compiles the
// REAL globals.css with the REAL Tailwind compiler, then asks the REAL DOM the
// editor emits which of the resulting selectors match it. That is the exact
// join the bug fell through: an unmatched class name.
async function compileGlobalsCss(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cssPath = path.resolve(here, "../../../app/globals.css");
  const require = createRequire(cssPath);
  const { compile } = require("tailwindcss") as typeof import("tailwindcss");
  const compiler = await compile(readFileSync(cssPath, "utf8"), {
    base: path.dirname(cssPath),
    loadStylesheet: async (id: string, base: string) => {
      const resolved = require.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id, { paths: [base] });
      return { path: resolved, base: path.dirname(resolved), content: readFileSync(resolved, "utf8") };
    },
    loadModule: async () => {
      throw new Error("globals.css loads no JS plugins");
    },
  });
  // The editor subtree's only class names; the rest of the app's utilities are
  // irrelevant to whether the page-editor rules exist.
  return compiler.build(["tc-page-editor", "tiptap", "ProseMirror"]);
}

// Selector -> declaration text, for every top-level rule in the compiled sheet
// whose selector mentions `.tc-page-editor`.
function pageEditorRules(css: string): { selector: string; body: string }[] {
  return css
    .split("}")
    .map((block) => ({ selector: (block.split("{")[0] ?? "").trim(), body: (block.split("{")[1] ?? "").trim() }))
    .filter((r) => r.selector.includes(".tc-page-editor") && r.body.length > 0);
}

describe("PageEditor typography (KI-44)", () => {
  it("defines .tc-page-editor rules that match the nodes the editor actually emits", async () => {
    const detail = tripDetailFixture();
    const overview = DEFAULT_TEMPLATES.find((t) => t.key === "trip-overview");
    expect(overview).toBeDefined();
    const { container } = render(
      <PageEditor
        detail={detail}
        context={{ tripId: detail.tripId }}
        value={overview!.content}
        onChange={() => {}}
      />,
    );

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const heading = container.querySelector("h2");
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const paragraph = container.querySelector("p");
    // The seeded Trip Overview page is the one the KI names by hand. If TipTap
    // ever stops emitting bare elements, the premise of the CSS below changed
    // and this test should fail loudly rather than pass vacuously.
    expect(heading?.textContent).toBe("Overview");
    expect(heading?.getAttribute("class")).toBeNull();
    expect(paragraph?.getAttribute("class")).toBeNull();

    const rules = pageEditorRules(await compileGlobalsCss());
    expect(rules.length).toBeGreaterThan(0);

    const declarationsFor = (el: Element) =>
      rules
        .filter((r) => r.selector.split(",").some((s) => el.matches(s.trim())))
        .map((r) => r.body)
        .join(" ");

    const headingCss = declarationsFor(heading!);
    const paragraphCss = declarationsFor(paragraph!);
    // Both must be styled at all — an unmatched class is the bug.
    expect(headingCss).toContain("font-size:");
    expect(paragraphCss).toContain("font-size:");
    // ...and styled DIFFERENTLY, which is the symptom the KI describes: the
    // `<h2>` "Overview" rendering identically to the sentence beneath it.
    const fontSize = (css: string) => /font-size:\s*([^;]+)/.exec(css)?.[1]?.trim();
    expect(fontSize(headingCss)).toBeDefined();
    expect(fontSize(headingCss)).not.toBe(fontSize(paragraphCss));
    expect(headingCss).toContain("font-weight:");
  });

  it("restores list markers preflight strips", async () => {
    const detail = tripDetailFixture();
    const content = newPageDoc([
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [] }] }] },
    ]);
    const { container } = render(
      <PageEditor detail={detail} context={{ tripId: detail.tripId }} value={content} onChange={() => {}} />,
    );
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const list = container.querySelector("ul");
    expect(list).not.toBeNull();

    const rules = pageEditorRules(await compileGlobalsCss());
    const listCss = rules
      .filter((r) => r.selector.split(",").some((s) => list!.matches(s.trim())))
      .map((r) => r.body)
      .join(" ");
    // Preflight sets `ol, ul, menu { list-style: none }`, so a bullet list with
    // no rule of its own renders with no bullets.
    expect(listCss).toContain("list-style-type: disc");
  });
});


// KI-2026-09-03-d, measured 2026-09-03. `MacroNodeExtension` declares
// `group: "inline", inline: true`, and ProseMirror agrees that `doc` does not
// accept one as a direct child — `doc.contentMatch.matchType(macro) === null`.
// Three things put one there anyway: `PageDoc`'s block union, the v1 golden,
// and the live AI compose path (`pageTools.ts`).
//
// The KI's worry was that this is a divergence pointing the WRONG way for
// ADR-038 decision 4 — our parser blessing a shape the editor rejects, which is
// the one direction that loses documents. It measured as INERT, and these are
// the measurements. The KI said to measure before changing any schema; nothing
// was changed, because nothing needs to be.
describe("PageEditor given a macro at block position (KI-2026-09-03-d)", () => {
  const topLevelMacro: PageDoc = newPageDoc([
    { type: "paragraph", content: [{ type: "text", text: "written by the user" }] },
    { type: "macro", attrs: { name: "cost.trip", params: {} } },
  ]);

  it("mounts it, renders it, and round-trips it — no warning, no discard", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onChange = vi.fn();
    try {
      render(<PageEditor detail={detail} context={context} value={topLevelMacro} onChange={onChange} />);

      await userEvent.type(screen.getByRole("textbox"), "x");

      // Not the unknown-node path: `Node.fromJSON` does not content-check, so
      // there is no `RangeError` for TipTap to swallow and no fallback to an
      // empty document. Contrast the describe block above, where the same
      // shape of test produces a warning and an empty doc.
      expect(warn).not.toHaveBeenCalled();

      const saved = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
      // The macro is still there, still at block position, unchanged — and so
      // is the user's paragraph. This is what makes the divergence harmless.
      expect(saved).toEqual({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "xwritten by the user" }] },
          { type: "macro", attrs: { name: "cost.trip", params: {} } },
        ],
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("is nonetheless a document ProseMirror's own checker rejects", async () => {
    // The part that is NOT inert, recorded so it is not rediscovered as a
    // surprise: `Node.check()` throws on this document. Nothing in the
    // production path calls it — it is a debug assertion — which is the entire
    // reason the case above passes. A ProseMirror or TipTap release that starts
    // calling `check()` on load turns this shape from harmless into the
    // whole-document discard, and this test is where that would show up.
    const { Editor } = await import("@tiptap/react");
    const editor = new Editor({
      extensions: PAGE_EDITOR_EXTENSIONS,
      content: topLevelMacro as unknown as Record<string, unknown>,
    });
    try {
      expect(() => editor.state.doc.check()).toThrow(/Invalid content for node doc/);
      expect(editor.schema.nodes.doc!.contentMatch.matchType(editor.schema.nodes.macro!)).toBeNull();
    } finally {
      editor.destroy();
    }
  });
});
