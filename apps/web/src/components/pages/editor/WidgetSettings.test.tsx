import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newPageDoc, type PageDoc, type TripGlobals } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { PageEditor } from "./PageEditor";
import { WidgetSettings } from "./WidgetSettings";
import { winningReport, type SelectedWidget } from "./MacroEditorContext";

afterEach(cleanup);

// Same stubs as `PageEditor.test.tsx`: jsdom has no layout engine, and
// ProseMirror reads geometry on every selection change.
beforeEach(() => {
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const detail = tripDetailFixture({
  days: [
    { dayId: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", activityIds: [], date: "2027-06-01", costSubtotal: 0 },
    { dayId: "2b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", activityIds: [], date: "2027-06-02", costSubtotal: 0 },
  ],
});
const globals: TripGlobals = {
  days: [
    { index: 0, date: "2027-06-01", cities: ["Tokyo"], activityCount: 0, costSubtotal: 0 },
    { index: 1, date: "2027-06-02", cities: ["Kyoto"], activityCount: 0, costSubtotal: 0 },
  ],
  cities: [
    { name: "Tokyo", dayIndexes: [0], activityCount: 0 },
    { name: "Kyoto", dayIndexes: [1], activityCount: 0 },
  ],
  tags: [],
  bookedCount: 0,
} as unknown as TripGlobals;

const DAY_1 = { dates: { from: "2027-06-01", through: "2027-06-01" } };
const DAY_2 = { dates: { from: "2027-06-02", through: "2027-06-02" } };
const city = (params: Record<string, unknown>) => ({ type: "macro" as const, attrs: { name: "city", params } });

// The M14 gate sentence — two day-bound widgets in ONE paragraph, pointed at
// different days — and a second paragraph whose widget must stay out of it.
const doc = newPageDoc([
  {
    type: "paragraph",
    content: [
      { type: "text", text: "We land on Day 1 in " },
      city(DAY_1),
      { type: "text", text: " and by Day 2 we are in " },
      city(DAY_2),
      { type: "text", text: "." },
    ],
  },
  { type: "paragraph", content: [{ type: "text", text: "Total: " }, { type: "macro", attrs: { name: "cost", params: {} } }] },
]);

// The screen's half, cut to the bone — and RELEASES COUNT, as they do in
// `PageScreen`: a flush holding only nulls closes the panel. A harness that
// ignored them hid a real bug the e2e walk then found: rebinding entry 1
// re-ran widget 1's node view, which reported "not selected", and the panel
// closed under the person using it. Every report is resolved per microtask by
// the screen's own rule (`winningReport`), so this is that, not a stand-in.
function Harness({ onEditor, value = doc }: { onEditor: (editor: Editor) => void; value?: PageDoc }) {
  const [selection, setSelection] = useState<SelectedWidget | null>(null);
  const pending = useRef<(SelectedWidget | null)[]>([]);
  const onWidgetSelected = useCallback((next: SelectedWidget | null) => {
    pending.current.push(next);
    if (pending.current.length > 1) return;
    queueMicrotask(() => {
      const reports = pending.current;
      pending.current = [];
      setSelection(winningReport(reports));
    });
  }, []);
  const onEditorReady = useCallback((editor: Editor | null) => {
    if (editor) onEditor(editor);
  }, [onEditor]);
  return (
    <>
      <PageEditor
        detail={detail}
        globals={globals}
        context={{ tripId: detail.tripId }}
        value={value}
        onChange={() => {}}
        onEditorReady={onEditorReady}
        onWidgetSelected={onWidgetSelected}
      />
      {selection ? <WidgetSettings selection={selection} detail={detail} globals={globals} /> : null}
    </>
  );
}

async function openOn(which: number): Promise<Editor> {
  let editor: Editor | undefined;
  render(<Harness onEditor={(e) => (editor = e)} />);
  await waitFor(() => expect(editor).toBeDefined());
  const positions: number[] = [];
  editor!.state.doc.descendants((node, pos) => {
    if (node.type.name === "macro") positions.push(pos);
  });
  editor!.view.dispatch(editor!.state.tr.setSelection(NodeSelection.create(editor!.state.doc, positions[which]!)));
  await screen.findByTestId("widget-settings");
  return editor!;
}

function paramsInDocument(editor: Editor): unknown[] {
  const out: unknown[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "macro") out.push(node.attrs.params);
  });
  return out;
}

describe("WidgetSettings — one entry per widget in the block (SPEC §26)", () => {
  it("shows both widgets of the sentence, numbered, and neither of them is the other paragraph's", async () => {
    // Selected via the SECOND widget: the panel is the block's, whichever of its
    // widgets was clicked.
    await openOn(1);
    const panel = within(screen.getByTestId("widget-settings"));
    const entries = panel.getAllByTestId("widget-settings-entry");
    expect(entries.map((e) => e.getAttribute("aria-label"))).toEqual(["1 · The cities", "2 · The cities"]);

    // And the numbers in the text agree with the entries, in document order.
    // The other paragraph's lone widget has no number: nothing to tell apart.
    const handles = screen.getAllByTestId("widget-handle");
    expect(handles.map((h) => h.textContent)).toEqual(["▸1", "▸2", "▸"]);
  });

  // **The box that fails if someone adds an aggregate control.** Rebinding one
  // entry must leave the other widget of the same sentence where it was.
  it("rebinds each widget of the sentence on its own", async () => {
    const editor = await openOn(0);
    const panel = within(screen.getByTestId("widget-settings"));

    await userEvent.click(panel.getByRole("button", { name: "2 · The cities: dates" }));
    await userEvent.click(within(await screen.findByRole("group", { name: "Trip days" })).getByRole("button", { name: /Day 1/ }));

    await waitFor(() => expect(paramsInDocument(editor)).toEqual([DAY_1, DAY_1, {}]));
    // The selection stayed on the widget the panel was opened for, so the
    // panel is still up and still holds both entries.
    expect(within(screen.getByTestId("widget-settings")).getAllByTestId("widget-settings-entry")).toHaveLength(2);
  });

  it("removes one widget of the sentence and keeps the other, and the prose", async () => {
    const editor = await openOn(0);
    const panel = within(screen.getByTestId("widget-settings"));

    await userEvent.click(panel.getByRole("button", { name: "Remove 2 · The cities" }));

    await waitFor(() => expect(paramsInDocument(editor)).toEqual([DAY_1, {}]));
    expect(editor.state.doc.child(0).textContent).toBe("We land on Day 1 in  and by Day 2 we are in .");
    // One left, so it is no longer numbered — in the panel or in the text.
    await waitFor(() =>
      expect(within(screen.getByTestId("widget-settings")).getByTestId("widget-settings-entry").getAttribute("aria-label")).toBe(
        "The cities",
      ),
    );
    expect(screen.getAllByTestId("widget-handle").map((h) => h.textContent)).toEqual(["▸", "▸"]);
  });
});

// The authored repeat's panel (PR #221 preview, 2026-09-24): which collection,
// the sentence, and the details it can print — and every write shows on the
// page at once, because the page resolves the sentence in Editing too.
describe("WidgetSettings for a sentence for each…", () => {
  const repeatDoc = (name: string, params: Record<string, unknown>) =>
    newPageDoc([{ type: "repeat", attrs: { name, params }, content: [] }]);

  async function openRepeat(value: PageDoc): Promise<Editor> {
    let editor: Editor | undefined;
    render(<Harness onEditor={(e) => (editor = e)} value={value} />);
    await waitFor(() => expect(editor).toBeDefined());
    editor!.view.dispatch(editor!.state.tr.setSelection(NodeSelection.create(editor!.state.doc, 0)));
    await screen.findByTestId("widget-settings");
    return editor!;
  }
  // eslint-disable-next-line testing-library/no-node-access -- a repeat line has no role of its own; the attribute is the handle the view puts on each line.
  const lines = () => [...document.querySelectorAll("[data-repeat-line]")].map((line) => line.textContent);
  const repeatAttrs = (editor: Editor) => editor.state.doc.child(0).attrs;

  it("shows what it repeats for, the sentence as written, and the details in words", async () => {
    await openRepeat(repeatDoc("city.rows", { template: "Welcome to {name}!" }));
    const panel = within(screen.getByTestId("widget-settings"));
    expect(panel.getByRole("heading", { name: "A sentence for each city" })).toBeTruthy();
    expect(panel.getByRole("radio", { name: "City" }).getAttribute("aria-checked")).toBe("true");
    expect((panel.getByRole("textbox", { name: "Sentence" }) as HTMLInputElement).value).toBe("Welcome to {name}!");
    const details = within(panel.getByRole("group", { name: "Details of each city" })).getAllByRole("button");
    expect(details.map((b) => b.textContent)).toEqual(["The city's name", "Which days touch this city", "How many stops are in this city"]);
    // And the page beside it reads the sentence, not the template.
    expect(lines()).toEqual(["Welcome to Tokyo!", "Welcome to Kyoto!"]);
  });

  it("drops a detail in at the caret, and the page follows every keystroke", async () => {
    const editor = await openRepeat(repeatDoc("city.rows", {}));
    const panel = within(screen.getByTestId("widget-settings"));
    const input = panel.getByRole("textbox", { name: "Sentence" }) as HTMLInputElement;
    await userEvent.type(input, "Welcome !");
    expect(lines()).toEqual(["Welcome !", "Welcome !"]);

    input.setSelectionRange("Welcome ".length, "Welcome ".length);
    await userEvent.click(panel.getByRole("button", { name: "The city's name" }));
    await waitFor(() => expect(repeatAttrs(editor).params).toEqual({ template: "Welcome {name}!" }));
    expect(lines()).toEqual(["Welcome Tokyo!", "Welcome Kyoto!"]);
    // The caret lands after the detail, so typing carries on from there.
    await userEvent.keyboard(" and hello");
    await waitFor(() => expect(repeatAttrs(editor).params).toEqual({ template: "Welcome {name} and hello!" }));
  });

  it("switches what it repeats for, keeping the sentence and dropping filters the new one does not take", async () => {
    const editor = await openRepeat(repeatDoc("stop.rows", { kind: "booked", template: "Hi {name}" }));
    await userEvent.click(within(screen.getByTestId("widget-settings")).getByRole("radio", { name: "City" }));
    await waitFor(() => expect(repeatAttrs(editor)).toEqual({ name: "city.rows", params: { template: "Hi {name}" } }));
    expect(lines()).toEqual(["Hi Tokyo", "Hi Kyoto"]);
    // Still selected, so the panel is still up, now about cities.
    expect(screen.getByRole("heading", { name: "A sentence for each city" })).toBeTruthy();
  });

  it("removes the sentence", async () => {
    const editor = await openRepeat(repeatDoc("day.rows", { template: "Day {date}" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove the sentence for each day" }));
    await waitFor(() => expect(editor.state.doc.child(0).type.name).toBe("paragraph"));
  });
});
