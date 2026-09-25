import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/react";
import { scenarios } from "@tc/factories";
import { newPageDoc, type PageDoc, type TripDetail, type TripGlobals } from "@tc/contracts";
import { PageEditor } from "./PageEditor";
import { toStoredPageDoc } from "./storedPageDoc";

// The authored repeat in the editor (ADR-035 decision 4; its sentence a
// template string since the PR #221 preview). The resolution rules are pinned
// in `@tc/pages`' `sentence.test.ts`; this is what reaches the page — and
// Mitchell's rule that Editing shows it exactly as Reading does.

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
  tags: [], homeTimeZone: null,
};
const context = { tripId: trip.tripId };

const repeatPage = (name: string, params: Record<string, unknown>): PageDoc =>
  newPageDoc([
    { type: "paragraph", content: [{ type: "text", text: "Our days:" }] },
    { type: "repeat", attrs: { name, params }, content: [] },
  ]);
// The gate's sentence, once per day.
const SENTENCE = "Day {date} — {cities}";
const sentence = (params: Record<string, unknown> = {}) => repeatPage("day.rows", { ...params, template: SENTENCE });
// A range no day falls in, so the repeat has nothing to repeat over.
const NO_DAYS = { dates: { from: "2031-01-01", through: "2031-01-02" } };

function mount(doc: PageDoc, editing: boolean, detail: TripDetail = trip) {
  let editor: Editor | null = null;
  const view = render(
    <PageEditor
      detail={detail}
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

const DAY_LINES = ["Day Jun 1, 2027 — Tokyo", "Day Jun 2, 2027 — Tokyo, Kyoto", "Day Jun 3, 2027 — Kyoto"];

describe("a sentence for each day", () => {
  it("reads one line per day in Reading, each filled from its own day", async () => {
    const { container } = mount(sentence(), false);
    await waitFor(() => expect(linesIn(container)).toEqual(DAY_LINES));
    // Reading shows no chrome.
    expect(screen.queryByTestId("repeat-rail")).toBeNull();
  });

  // Mitchell's hard rule: a widget in Editing reads as it will in the notebook.
  it("reads the SAME lines in Editing, on an accented rail naming what it repeats over", async () => {
    const { container } = mount(sentence(), true);
    const rail = await screen.findByTestId("repeat-rail");
    expect(rail.textContent).toBe("For every day · 3 days");
    expect(rail.getAttribute("data-resolved")).toBe("true");
    expect(linesIn(container)).toEqual(DAY_LINES);
    // The sentence as written is the settings panel's, never the page's.
    expect(container.textContent).not.toContain("{date}");
  });

  it("reads as its empty text in both modes when there is no day to repeat over", async () => {
    for (const editing of [false, true]) {
      const { container, unmount } = mount(sentence(NO_DAYS), editing);
      await screen.findByText("no days to show");
      expect(linesIn(container)).toEqual([]);
      if (editing) expect(screen.getByTestId("repeat-rail").textContent).toBe("For every day · none yet");
      unmount();
    }
  });

  // A repeat inserted and never written: three days to repeat over, and no
  // sentence. Reading printed three empty paragraphs once — a gap the reader
  // cannot explain (M14 PART 3 review, finding 5).
  it("reads as nothing in Reading when its sentence has not been written, and asks for one in Editing", async () => {
    const unwritten = repeatPage("day.rows", {});
    const reading = mount(unwritten, false);
    await screen.findByText("Our days:");
    // eslint-disable-next-line testing-library/no-node-access -- the claim is "no paragraph a reader sees"; an empty repeat has no role to query by.
    expect(reading.container.querySelectorAll("[data-repeat-over] p")).toHaveLength(0);
    reading.unmount();

    mount(unwritten, true);
    await screen.findByText(/Write the sentence for each day/);
  });

  it("round-trips through the stored format exactly (ADR-038)", async () => {
    const doc = sentence({ dates: { from: "2027-06-01", through: "2027-06-02" } });
    const { editor } = mount(doc, true);
    await waitFor(() => expect(editor()).not.toBeNull());
    expect(toStoredPageDoc(editor()!.getJSON())).toEqual(doc);
  });
});

describe("a sentence for each stop, with a name that is markup", () => {
  it("prints the name as text in both modes — no element, no attribute, no handler", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const firstId = trip.days[0]!.activityIds[0]!;
    const named: TripDetail = {
      ...trip,
      activities: { ...trip.activities, [firstId]: { ...trip.activities[firstId]!, title: hostile } },
    };
    for (const editing of [false, true]) {
      const { container, unmount } = mount(repeatPage("stop.rows", { template: "Next: {title}" }), editing, named);
      await waitFor(() => expect(linesIn(container)[0]).toBe(`Next: ${hostile}`));
      expect(screen.queryByRole("img")).toBeNull();
      // eslint-disable-next-line testing-library/no-node-access -- the claim is that no element was parsed out of the name, which only the DOM can answer.
      expect(container.querySelector("[onerror]")).toBeNull();
      unmount();
    }
  });
});
