import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/react";
import { scenarios } from "@tc/factories";
import { newPageDoc, type PageDoc, type PageInlineNode, type TripGlobals } from "@tc/contracts";
import { PageEditor } from "./PageEditor";
import { toStoredPageDoc } from "./storedPageDoc";

// The authored repeat in the editor (ADR-035 decision 4, M14 link 6): one
// template, written once, read once per item. The resolution rules are pinned
// in `@tc/pages`' `repeat.test.ts`; this is what reaches the page.

beforeEach(() => {
  // jsdom has no layout engine; the same stubs `PageEditor.test.tsx` uses.
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

// Three dated days over two cities, the middle one a travel day.
const trip = scenarios.threeDayTrip();
trip.days[0]!.date = "2027-06-01";
trip.days[1]!.date = "2027-06-02";
trip.days[2]!.date = "2027-06-03";
const day = (index: number, cities: string[]) => ({
  index, date: trip.days[index]!.date, cities, activityCount: 2, costSubtotal: trip.days[index]!.costSubtotal,
  place: null, timeZone: null,
});
const globals: TripGlobals = {
  days: [day(0, ["Tokyo"]), day(1, ["Tokyo", "Kyoto"]), day(2, ["Kyoto"])],
  cities: [
    { name: "Tokyo", dayIndexes: [0, 1], activityCount: 2 },
    { name: "Kyoto", dayIndexes: [1, 2], activityCount: 2 },
  ],
  tags: [], bookedCount: 0, homeTimeZone: null,
};
const context = { tripId: trip.tripId };

const text = (t: string): PageInlineNode => ({ type: "text", text: t });
const widget = (name: string): PageInlineNode => ({ type: "macro", attrs: { name, params: {} } });
// The gate's sentence: "Day <date> — <city>", once per day.
const sentence = (params: Record<string, unknown> = {}): PageDoc =>
  newPageDoc([
    { type: "paragraph", content: [text("Our days:")] },
    { type: "repeat", attrs: { name: "day.rows", params }, content: [text("Day "), widget("dates"), text(" — "), widget("city")] },
  ]);
// A range no day falls in, so the repeat has nothing to repeat over.
const NO_DAYS = { dates: { from: "2031-01-01", through: "2031-01-02" } };

function mount(doc: PageDoc, editing: boolean) {
  let editor: Editor | null = null;
  const view = render(
    <PageEditor
      detail={trip}
      context={context}
      globals={globals}
      value={doc}
      onChange={() => {}}
      editable={editing}
      onEditorReady={(e) => {
        editor = e ?? editor;
      }}
    />,
  );
  return { ...view, editor: () => editor };
}

// eslint-disable-next-line testing-library/no-node-access -- a repeat line has no role of its own; the attribute is the handle the view puts on each line.
const linesIn = (root: HTMLElement) => [...root.querySelectorAll("[data-repeat-line]")].map((line) => line.textContent);

describe("a sentence for every day", () => {
  it("reads one line per day in Reading, each widget filled from its own day", async () => {
    const { container } = mount(sentence(), false);
    await waitFor(() => expect(linesIn(container)).toHaveLength(3));
    expect(linesIn(container)).toEqual([
      "Day Jun 1, 2027 — Tokyo",
      "Day Jun 2, 2027 — Tokyo – Kyoto",
      "Day Jun 3, 2027 — Kyoto",
    ]);
    // Reading shows no chrome.
    expect(screen.queryByTestId("repeat-rail")).toBeNull();
  });

  it("shows the template once in Editing, on an accented rail naming what it repeats over", async () => {
    const { container } = mount(sentence(), true);
    const rail = await screen.findByTestId("repeat-rail");
    expect(rail.textContent).toBe("For every day · 3 days");
    expect(rail.getAttribute("data-resolved")).toBe("true");
    expect(linesIn(container)).toEqual([]);
    // The template's widgets preview the FIRST day, so the author writes
    // against a real line — once, not three times.
    await screen.findByText("Jun 1, 2027");
    expect(screen.queryByText("Jun 2, 2027")).toBeNull();
  });

  it("reads as its empty text in Reading when there is no day to repeat over", async () => {
    const { container } = mount(sentence(NO_DAYS), false);
    await screen.findByText("no days to show");
    expect(linesIn(container)).toEqual([]);
    // The template is not read out as though it were a line.
    // eslint-disable-next-line testing-library/no-node-access -- "hidden from the reader" is the claim; the `hidden` ancestor is what makes it true, and no query exposes it.
    expect(screen.getByText(/^Day /).closest("[hidden]")).not.toBeNull();
  });

  // A repeat inserted and never written: three days to repeat over, and no
  // sentence. Reading used to print three empty paragraphs — a gap the reader
  // cannot explain (M14 PART 3 review, finding 5).
  it("reads as nothing in Reading when its sentence has not been written", async () => {
    const unwritten = newPageDoc([
      { type: "paragraph", content: [text("Our days:")] },
      { type: "repeat", attrs: { name: "day.rows", params: {} }, content: [] },
    ]);
    const { container } = mount(unwritten, false);
    await screen.findByText("Our days:");
    // eslint-disable-next-line testing-library/no-node-access -- the claim is "no paragraph a reader sees"; a hidden or empty <p> has no role to query by.
    const shown = [...container.querySelectorAll("[data-repeat-over] p")].filter((p) => !p.closest("[hidden]"));
    expect(shown).toEqual([]);
    expect(linesIn(container)).toEqual([]);
  });

  it("keeps the rail and the template in Editing when there is nothing to repeat over", async () => {
    const { container } = mount(sentence(NO_DAYS), true);
    const rail = await screen.findByTestId("repeat-rail");
    expect(rail.textContent).toBe("For every day · none yet");
    // Neutral, not accented: nothing resolved.
    expect(rail.getAttribute("data-resolved")).toBe("false");
    // The template is still there to write into.
    expect(container.textContent).toContain("Day ");
    expect(screen.queryByText("no days to show")).toBeNull();
  });

  it("round-trips through the stored format exactly (ADR-038)", async () => {
    const doc = sentence({ dates: { from: "2027-06-01", through: "2027-06-02" } });
    const { editor } = mount(doc, true);
    await waitFor(() => expect(editor()).not.toBeNull());
    expect(toStoredPageDoc(editor()!.getJSON())).toEqual(doc);
  });

  it("ends the sentence on Enter rather than splitting it into two repeats", async () => {
    const { editor } = mount(sentence(), true);
    await waitFor(() => expect(editor()).not.toBeNull());
    const e = editor()!;
    // The caret at the end of the template: after "Our days:" (11) and into the repeat.
    act(() => {
      e.commands.setTextSelection(e.state.doc.child(0).nodeSize + e.state.doc.child(1).nodeSize - 1);
      // Through the view's own key handling, as a keystroke arrives. TipTap's
      // `keyboardShortcut` command keeps a handler's steps and drops its
      // selection, which would test the harness rather than the node.
      e.view.someProp("handleKeyDown", (handle) => handle(e.view, new KeyboardEvent("keydown", { key: "Enter" })));
    });
    const types = (e.getJSON().content ?? []).map((node) => node.type);
    expect(types).toEqual(["paragraph", "repeat", "paragraph"]);
    expect(e.state.selection.$from.parent.type.name).toBe("paragraph");
  });
});
