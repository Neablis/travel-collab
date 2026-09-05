import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newPageDoc } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { PageEditor } from "./PageEditor";

afterEach(cleanup);

// Same stubs as `PageEditor.test.tsx`: jsdom has no layout engine, and
// ProseMirror reads geometry on every selection change.
beforeEach(() => {
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

// Compile the app's real stylesheet for the handful of utility classes the node
// view puts on a widget's wrapper, so the assertions below are about
// `display: block` and a `box-shadow`, not about class-name spelling.
async function declarationsForClasses(classes: string[]): Promise<Record<string, string>> {
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
  const css = compiler.build(classes);
  const out: Record<string, string> = {};
  // Innermost rules only. Tailwind v4 nests utilities inside `@layer utilities
  // { … }`, so splitting the sheet on braces reads the layer's own opening
  // brace as a rule and mis-attributes the first utility in it.
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1] ?? "";
    const body = (match[2] ?? "").trim();
    if (!body) continue;
    for (const cls of classes) {
      // Tailwind escapes selector-special characters with backslashes
      // (`.ring-2\/50`); drop them before comparing to the plain class name.
      if (selector.split(",").some((s) => s.trim().replace(/\\/g, "") === `.${cls}`)) {
        out[cls] = (out[cls] ?? "") + " " + body;
      }
    }
  }
  return out;
}

const detail = tripDetailFixture();

// `day.detail` is `shape: "block"` and `cost` is `shape: "single"` — one of
// each, in one document, because the whole claim is that they are treated
// differently.
function renderTwoWidgets(onEditor: (editor: Editor) => void) {
  return render(
    <PageEditor
      detail={detail}
      context={{ tripId: detail.tripId }}
      value={newPageDoc([
        { type: "paragraph", content: [{ type: "macro", attrs: { name: "day.detail", params: {} } }] },
        { type: "paragraph", content: [{ type: "macro", attrs: { name: "cost", params: {} } }] },
      ])}
      onChange={() => {}}
      onEditorReady={(editor) => {
        if (editor) onEditor(editor);
      }}
    />,
  );
}

// Positions of the two macro atoms in the document above: `<doc><p><macro/></p>
// <p><macro/></p></doc>` — the first paragraph opens at 0, so its macro sits at
// 1, and the second paragraph opens at 3.
const BLOCK_POS = 1;
const INLINE_POS = 4;

async function selectNodeAt(editor: Editor, pos: number) {
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  await waitFor(() => {
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });
}

describe("MacroNodeView selected state (KI-2026-09-05-a)", () => {
  // **The selected state must be painted on a box the same shape as the
  // widget.** ProseMirror does select a block widget when it is clicked — that
  // half was never broken. What was broken is that the only feedback saying so
  // was `ring-2` on an INLINE `<span>`, while the card it wraps is a block box,
  // and a ring on an inline box is painted per line fragment: measured in
  // Chromium on a selected `day.detail`, two stubs at the card's left and right
  // edges instead of an outline round it. That is what made the card feel
  // unselectable, and why the reader read the caret beside it as the only
  // response to their click.
  //
  // jsdom has no layout, so this cannot measure the painted ring. What it CAN
  // check is the join the fix depends on: the element the ring lands on is the
  // one the stylesheet gives `display: block`, and a `single` widget still gets
  // the inline ring a word in a sentence should get.
  it("gives a selected block widget a ring on a block box, and a selected inline widget a ring on an inline one", async () => {
    let editor!: Editor;
    const { container } = renderTwoWidgets((e) => {
      editor = e;
    });
    await waitFor(() => expect(editor).toBeDefined());

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the claim is about which element a CSS class lands on; no role or label stands in for that.
    const wrapperFor = (name: string) => container.querySelector(`[data-node-view-wrapper][data-macro-name="${name}"]`);

    // Nothing selected: neither widget carries a ring.
    expect(wrapperFor("day.detail")?.className ?? "").not.toContain("ring-2");
    expect(wrapperFor("cost")?.className ?? "").not.toContain("ring-2");

    await selectNodeAt(editor, BLOCK_POS);
    await waitFor(() => expect(wrapperFor("day.detail")?.className ?? "").toContain("ring-2"));
    const blockClasses = (wrapperFor("day.detail")!.className as string).split(/\s+/).filter(Boolean);

    await selectNodeAt(editor, INLINE_POS);
    await waitFor(() => expect(wrapperFor("cost")?.className ?? "").toContain("ring-2"));
    const inlineClasses = (wrapperFor("cost")!.className as string).split(/\s+/).filter(Boolean);

    const rules = await declarationsForClasses([...new Set([...blockClasses, ...inlineClasses])]);
    const cssFor = (classes: string[]) => classes.map((c) => rules[c] ?? "").join(" ");

    // Every class the node view wrote has to be a class the stylesheet answers —
    // a ring utility nothing compiles is the silent half of this bug.
    expect(cssFor(blockClasses)).toContain("box-shadow");
    expect(cssFor(inlineClasses)).toContain("box-shadow");

    // The point: the selected BLOCK widget's ring is on a block box...
    expect(cssFor(blockClasses)).toContain("display: block");
    // ...and the selected SINGLE widget's is not. A `single` widget IS a word in
    // a sentence (SPEC §7); taking it out of the line to draw a ring round it
    // would fix a card by breaking a chip.
    expect(cssFor(inlineClasses)).not.toContain("display: block");
  });
});
