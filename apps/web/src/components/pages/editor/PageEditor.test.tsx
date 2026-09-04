import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newPageDoc } from "@tc/contracts";
import type { PageDoc } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { DEFAULT_TEMPLATES, macroCatalog } from "@tc/pages";
import { widgetMatches } from "@/components/pages/WidgetPicker";
import { PageEditor } from "./PageEditor";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";
import { MAX_ROWS, slashOptionId } from "./useSlashMenu";

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

  // **The caret, and the second time Mitchell reported it.**
  //
  // A macro node is an inline atom, so a block-shaped widget is a tall inline
  // box sitting on the text baseline — it grows the line box upward, and the
  // browser draws the caret at the line box's height. *"The cursor still
  // stretches past the sidebar up above the top of the previous widget."*
  //
  // jsdom has no layout, so this cannot measure a caret. What it CAN check is
  // the join the fix depends on and the one that will rot: the node view marks
  // the widget's shape on the DOM, and the stylesheet takes a block-shaped one
  // out of the line box. Either half alone is silent — a `data-macro-shape`
  // nothing selects, or a rule matching an attribute nobody writes — which is
  // exactly the class of bug KI-44 above was.
  it("takes a block-shaped widget out of the paragraph's line box, and leaves an inline one in it", async () => {
    const { container } = render(
      <PageEditor
        detail={tripDetailFixture()}
        context={{ tripId: detail.tripId }}
        value={newPageDoc([
          {
            type: "paragraph",
            content: [
              { type: "macro", attrs: { name: "cost.trip", params: {} } },
              { type: "macro", attrs: { name: "itinerary.trip", params: {} } },
            ],
          },
        ])}
        onChange={() => {}}
      />,
    );

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing pattern. The claim is about a CSS selector matching a DOM node, and there is no role or label standing in for either.
    const blockWidget = container.querySelector('[data-macro-shape="block"]');
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- as above.
    const inlineWidget = container.querySelector('[data-macro-shape="single"]');
    // The node view has to have written the attribute at all — a shape read
    // off the registry that silently answered `undefined` would leave both of
    // these null and every assertion below vacuous.
    expect(blockWidget).not.toBeNull();
    expect(inlineWidget).not.toBeNull();

    const rules = pageEditorRules(await compileGlobalsCss());
    const declarationsFor = (el: Element) =>
      rules
        .filter((r) => r.selector.split(",").some((sel) => el.matches(sel.trim())))
        .map((r) => r.body)
        .join(" ");

    expect(declarationsFor(blockWidget!)).toContain("display: block");
    // A `single` widget IS a word in a sentence and must keep sharing the line
    // — taking every widget out of the flow would fix the caret by breaking
    // what a chip is for.
    expect(declarationsFor(inlineWidget!)).not.toContain("display: block");
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

// The slash menu — Mitchell, on the preview: *"Typing '/' doesnt bring up the
// inline widget picker"*. It is the third origin of the one insert command
// (ADR-037 decision 4), after the popover's click and the drag.
describe("the slash menu", () => {
  // The block above stubs `getClientRects` to zero rects, which is enough for
  // ProseMirror to place a cursor and not enough for it to answer
  // `coordsAtPos` — and the menu is positioned at the caret, so it asks. One
  // real rect is the smallest fake that makes the feature reachable; every
  // assertion below is about the menu's CONTENT, never its coordinates, which
  // is the part jsdom cannot honestly answer.
  // The caret's rect, mutable so a test can move it and then fire a scroll —
  // which is the only way to simulate the page moving under a `position: fixed`
  // menu in a DOM with no layout.
  let caretRect = new DOMRect(10, 20, 0, 5);
  beforeEach(() => {
    caretRect = new DOMRect(10, 20, 0, 5);
    Range.prototype.getClientRects = () =>
      ({ length: 1, item: () => caretRect, 0: caretRect }) as unknown as DOMRectList;
  });

  const editorFor = (onChange = vi.fn()) => {
    render(
      <PageEditor
        detail={detail}
        context={context}
        value={newPageDoc([{ type: "paragraph", content: [] }])}
        onChange={onChange}
      />,
    );
    return screen.getByRole("textbox");
  };

  it("opens at the caret when you type a slash, listing widgets by their title", async () => {
    await userEvent.type(editorFor(), "/");
    const menu = await screen.findByRole("listbox", { name: "Insert a widget" });
    expect(within(menu).getAllByRole("option").length).toBeGreaterThan(0);
    expect(within(menu).getByRole("option", { name: /The trip's name/ })).toBeTruthy();
  });

  it("narrows as you keep typing, and closes when nothing matches", async () => {
    const textbox = editorFor();
    await userEvent.type(textbox, "/trip");
    const menu = await screen.findByRole("listbox");
    const shown = within(menu).getAllByRole("option");
    // **Exactly the widgets that match, in the registry's order.** "some
    // options exist" passes for a menu that filtered nothing at all, which is
    // the regression this test is about (CodeRabbit, PR 139).
    //
    // The expectation is DERIVED from the same registry and the same matcher
    // the menu uses, rather than a list of titles typed here: a copied list
    // goes stale the first time someone adds a widget whose description happens
    // to say "trip", and would then fail for a reason that is not a bug.
    //
    // Capped at the menu's OWN limit, not at however many rows happened to
    // render. `slice(0, shown.length)` made the expectation follow the result:
    // a regression rendering only the first match would have compared one
    // option against a one-item list and passed (CodeRabbit, PR 139). `MAX_ROWS`
    // is imported rather than copied, for the same reason the list is derived.
    const expected = macroCatalog()
      .filter((w) => widgetMatches(w, "trip"))
      .slice(0, MAX_ROWS)
      .map((w) => w.title);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(macroCatalog().length);
    expect(shown).toHaveLength(expected.length);
    for (const [i, option] of shown.entries()) {
      expect(option.textContent).toContain(expected[i]!);
    }

    // A query nothing answers closes the menu rather than showing an empty box:
    // at that point the person is writing a date, not choosing a widget, and a
    // menu hovering over "9/11" is in the way.
    await userEvent.type(textbox, "zzzz");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  // The one that matters: the typed `/query` is REPLACED, not left behind.
  it("inserts the highlighted widget on Enter, and takes the typed query with it", async () => {
    const onChange = vi.fn();
    const textbox = editorFor(onChange);
    await userEvent.type(textbox, "/trip.name");
    await screen.findByRole("listbox");
    await userEvent.type(textbox, "{Enter}");

    expect(screen.queryByRole("listbox")).toBeNull();
    const last = JSON.stringify(onChange.mock.calls.at(-1)![0]);
    expect(last).toContain('"macro"');
    expect(last).toContain('"trip.name"');
    // The text that summoned the menu is gone. Leaving it behind is the defect
    // this asserts against — the widget lands and the page reads "/trip.name"
    // beside it.
    expect(last).not.toContain("/trip.name");
  });

  // Mitchell, on the preview: *"starting to type the widget should filter down,
  // then tab iterates and enter selects"*. Tab used to commit like Enter — two
  // keys doing one job, and the job Tab is actually wanted for left undone.
  it("moves the highlight on Tab rather than inserting, and Enter takes what Tab landed on", async () => {
    const onChange = vi.fn();
    const textbox = editorFor(onChange);
    await userEvent.type(textbox, "/");
    const menu = await screen.findByRole("listbox");
    const options = within(menu).getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    // The first row starts selected; Tab moves to the second and inserts
    // NOTHING on the way.
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");

    await userEvent.type(textbox, "{Tab}");
    const afterTab = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(afterTab[0]!.getAttribute("aria-selected")).toBe("false");
    expect(afterTab[1]!.getAttribute("aria-selected")).toBe("true");
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0] ?? {})).not.toContain('"macro"');

    // ...and Enter takes the row Tab landed on, not the one it started on.
    //
    // Asserted as the widget's own STORED NAME, not as "a macro landed":
    // checking for `"macro"` anywhere in the document passes when Enter inserts
    // the first option, which is precisely the bug Tab-then-Enter exists to
    // rule out (CodeRabbit, PR 139). The name comes from the option's id, which
    // `slashOptionId` derives from the registry — so the assertion cannot name
    // a widget the menu was not actually showing.
    const chosen = macroCatalog().find((w) => slashOptionId(w.name) === afterTab[1]!.id);
    expect(chosen).toBeDefined();
    expect(chosen!.name).not.toBe(macroCatalog().find((w) => slashOptionId(w.name) === afterTab[0]!.id)!.name);
    await userEvent.type(textbox, "{Enter}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(JSON.stringify(onChange.mock.calls.at(-1)![0])).toContain(`"${chosen!.name}"`);
  });

  // **The editor keeps focus, so the editor has to announce the listbox.** A
  // sighted user watches the highlight move as Tab iterates; a screen-reader
  // user was told nothing, because the focused element had no relationship to
  // the list and the rows had no ids (Copilot, PR 139).
  //
  // Asserted as the LINK rather than as the attributes in isolation: an
  // `aria-activedescendant` naming an id no option carries is exactly as silent
  // as none at all, and is what a renamed id would leave behind.
  it("names the highlighted option on the focused editor, and keeps naming it as Tab moves", async () => {
    const textbox = editorFor(vi.fn());
    await userEvent.type(textbox, "/");
    const menu = await screen.findByRole("listbox");
    expect(textbox.getAttribute("aria-expanded")).toBe("true");
    expect(textbox.getAttribute("aria-controls")).toBe(menu.id);
    expect(menu.id).not.toBe("");

    const activeOption = () =>
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .find((o) => o.getAttribute("aria-selected") === "true")!;
    expect(textbox.getAttribute("aria-activedescendant")).toBe(activeOption().id);
    const firstId = activeOption().id;

    await userEvent.type(textbox, "{Tab}");
    expect(activeOption().id).not.toBe(firstId);
    expect(textbox.getAttribute("aria-activedescendant")).toBe(activeOption().id);

    // Closed means closed, on ALL THREE attributes. `aria-expanded="true"` left
    // on a plain text box is worse than never having set it — and so is an
    // `aria-controls` still naming a listbox that has been removed from the
    // document, which is the one this checked two of three and missed
    // (CodeRabbit, PR 139). `useSlashMenu` removes all three together, so the
    // test has to say all three or it is not testing the teardown it describes.
    await userEvent.type(textbox, "{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(textbox.hasAttribute("aria-expanded")).toBe(false);
    expect(textbox.hasAttribute("aria-controls")).toBe(false);
    expect(textbox.hasAttribute("aria-activedescendant")).toBe(false);
  });

  // Mitchell, on the preview: *"scrolling on the page should keep the widget
  // alongside the cursor not the page"*. The menu is positioned at viewport
  // coordinates, computed when it opened and then only recomputed on a
  // transaction — and scrolling is not a transaction, so the document slid away
  // underneath a menu parked where the caret used to be.
  it("follows the caret when the page scrolls", async () => {
    await userEvent.type(editorFor(), "/");
    const menu = await screen.findByRole("listbox");
    expect(menu.style.top).toBe("25px");

    // The page scrolls: same caret, new viewport position.
    caretRect = new DOMRect(10, 100, 0, 5);
    fireEvent.scroll(document, {});

    await waitFor(() => expect(screen.getByRole("listbox").style.top).toBe("105px"));
  });

  it("closes on Escape without inserting anything", async () => {
    const onChange = vi.fn();
    const textbox = editorFor(onChange);
    await userEvent.type(textbox, "/trip");
    await screen.findByRole("listbox");
    await userEvent.type(textbox, "{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0] ?? {})).not.toContain('"macro"');
  });

  // `and/or`, a date, a URL. A menu that opens mid-word is the reason people
  // turn this feature off.
  it("stays shut for a slash inside a word", async () => {
    await userEvent.type(editorFor(), "and/or");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
