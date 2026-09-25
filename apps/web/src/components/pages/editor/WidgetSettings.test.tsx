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

describe("WidgetSettings — one widget at a time (KI-2026-09-24-x)", () => {
  // Mitchell, PR #221: *"Just have 1 selected at a time."* A sentence holding
  // two widgets opens a panel about the ONE that was clicked: no list of the
  // whole block, and no numbers on the handles to match it against.
  it("shows only the selected widget of the sentence, unnumbered, in the panel and in the text", async () => {
    await openOn(1);
    const panel = within(screen.getByTestId("widget-settings"));
    expect(panel.getAllByTestId("widget-settings-entry").map((e) => e.getAttribute("aria-label"))).toEqual(["The cities"]);
    expect(screen.getAllByTestId("widget-handle").map((h) => h.textContent)).toEqual(["▸", "▸", "▸"]);
  });

  // **The box that fails if someone adds an aggregate control** (ADR-037 open
  // question 1), and the proof that the one entry is the SELECTED widget's.
  // Showing one at a time changes the panel, not that rule: widening either
  // widget of the sentence leaves the other on its own day.
  it.each([
    { which: "first", selected: 0, after: [{}, DAY_2, {}] },
    { which: "second", selected: 1, after: [DAY_1, {}, {}] },
  ])("rebinds the $which widget of the sentence on its own", async ({ selected, after }) => {
    const editor = await openOn(selected);
    await userEvent.click(within(screen.getByTestId("widget-settings")).getByRole("button", { name: "The cities: dates" }));
    await userEvent.click(await screen.findByRole("button", { name: "All days" }));

    await waitFor(() => expect(paramsInDocument(editor)).toEqual(after));
    // The selection stayed on the widget the panel was opened for.
    expect(within(screen.getByTestId("widget-settings")).getAllByTestId("widget-settings-entry")).toHaveLength(1);
  });

  it("removes the selected widget, keeps the other and the prose, and closes", async () => {
    const editor = await openOn(1);
    await userEvent.click(within(screen.getByTestId("widget-settings")).getByRole("button", { name: "Remove The cities" }));

    await waitFor(() => expect(paramsInDocument(editor)).toEqual([DAY_1, {}]));
    expect(editor.state.doc.child(0).textContent).toBe("We land on Day 1 in  and by Day 2 we are in .");
    // Nothing is selected any more, so there is nothing for the panel to be
    // about. Moving the selection to the sentence's other widget would put a
    // panel titled "The cities" straight back up, reading as if Remove had not
    // worked.
    await waitFor(() => expect(screen.queryByTestId("widget-settings")).toBeNull());
  });
});

// Mitchell, PR #221 preview: *"We combined a 'Sentence for every ...' and added
// a picker for type, can we do the same for 'A line for every....'?"*. A rows
// table's entry opens with "Lines for each", and switching it rewrites the
// widget's name and keeps only the params the new primitive takes — as ONE
// edit, so one undo puts both back.
describe("WidgetSettings for a line for each…", () => {
  const tableDoc = (name: string, params: Record<string, unknown>) =>
    newPageDoc([{ type: "paragraph", content: [{ type: "macro", attrs: { name, params } }] }]);
  const tableAttrs = (editor: Editor) => editor.state.doc.child(0).child(0).attrs;

  async function openTable(value: PageDoc): Promise<Editor> {
    let editor: Editor | undefined;
    render(<Harness onEditor={(e) => (editor = e)} value={value} />);
    await waitFor(() => expect(editor).toBeDefined());
    editor!.view.dispatch(editor!.state.tr.setSelection(NodeSelection.create(editor!.state.doc, 1)));
    await screen.findByTestId("widget-settings");
    return editor!;
  }

  it("moves a stop table to cities, keeping only what a city list takes, in one undoable edit", async () => {
    const stops = { city: "Kyoto", kind: "booked", columns: ["stop.cost"] };
    const editor = await openTable(tableDoc("stop.rows", stops));
    const picker = within(screen.getByRole("radiogroup", { name: "Lines for each" }));
    expect(picker.getByRole("radio", { name: "Stop" }).getAttribute("aria-checked")).toBe("true");

    await userEvent.click(picker.getByRole("radio", { name: "City" }));
    await waitFor(() => expect(tableAttrs(editor)).toEqual({ name: "city.rows", params: { city: "Kyoto" } }));
    // Still selected, so the panel is still up — now about the city table.
    const panel = within(screen.getByTestId("widget-settings"));
    expect(panel.getByRole("heading", { name: "A line for every city" })).toBeTruthy();
    expect(panel.getByRole("radio", { name: "City" }).getAttribute("aria-checked")).toBe("true");

    editor.commands.undo();
    expect(tableAttrs(editor)).toEqual({ name: "stop.rows", params: stops });
  });

  it("keeps a stop table's columns only while it lists stops", async () => {
    const editor = await openTable(tableDoc("day.rows", { city: "Tokyo" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Lines for each" })).getByRole("radio", { name: "Stop" }));
    await waitFor(() => expect(tableAttrs(editor)).toEqual({ name: "stop.rows", params: { city: "Tokyo" } }));
    // Stops take columns, so the panel now offers them.
    expect(within(screen.getByTestId("widget-settings")).getByRole("combobox", { name: /add a column/i })).toBeTruthy();
  });

  it("offers no collection to a widget that is not a table", async () => {
    await openOn(0);
    expect(screen.queryByRole("radiogroup", { name: /lines for each/i })).toBeNull();
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
    // Mitchell, PR 221 preview: *"Oh i didnt realize this was a shortcut for the
    // templates"*. The group is headed by what a button DOES, says where the
    // detail goes, and each button reads "+ <short name>".
    const group = panel.getByRole("group", { name: "Insert a detail" });
    expect(group.getAttribute("aria-describedby")).toBeTruthy();
    // eslint-disable-next-line testing-library/no-node-access -- the hint is found by the id the group points at, which is the relationship under test.
    expect(document.getElementById(group.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Adds it to the sentence at the cursor, filled in for each city.",
    );
    const details = within(group).getAllByRole("button");
    expect(details.map((b) => b.textContent)).toEqual(["+City", "+Trip days", "+Number of stops"]);
    // The "+" is decoration: each button is named by its detail alone.
    expect(details.map((b) => b.getAttribute("aria-label") ?? b.textContent!.replace(/^\+/, ""))).toEqual([
      "City", "Trip days", "Number of stops",
    ]);
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
    await userEvent.click(panel.getByRole("button", { name: "City" }));
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

  // Mitchell, PR 221 preview: *"Changing repeat pretty much will always break
  // the string templates since they have different names"*. A detail the new
  // collection lacks never reaches the page as raw braces.
  it("swaps in the new collection's starting sentence when the old one names a detail it lacks", async () => {
    const editor = await openRepeat(repeatDoc("day.rows", { template: "{index}: {cities}" }));
    await userEvent.click(within(screen.getByTestId("widget-settings")).getByRole("radio", { name: "City" }));
    await waitFor(() => expect(repeatAttrs(editor)).toEqual({ name: "city.rows", params: { template: "Welcome to {name}" } }));
    expect(lines()).toEqual(["Welcome to Tokyo", "Welcome to Kyoto"]);
    expect((screen.getByRole("textbox", { name: "Sentence" }) as HTMLInputElement).value).toBe("Welcome to {name}");
  });

  // Review of #221: the rows primitive's filters are the repeat's selection,
  // and the panel used to offer none of them — "every city but Tokyo" could not
  // be built, and a migrated repeat's stored filter could not be seen.
  it("narrows which items it is for with the collection's own filters, keeping the sentence", async () => {
    const editor = await openRepeat(repeatDoc("city.rows", { template: "Welcome to {name}" }));
    const panel = within(screen.getByTestId("widget-settings"));
    await userEvent.selectOptions(panel.getByRole("combobox", { name: "A sentence for each city: city" }), "Kyoto");
    await waitFor(() => expect(repeatAttrs(editor).params).toEqual({ city: "Kyoto", template: "Welcome to {name}" }));
    expect(lines()).toEqual(["Welcome to Kyoto"]);
  });

  it("shows a stored filter and clears it back to every item, and offers no table columns", async () => {
    const editor = await openRepeat(repeatDoc("stop.rows", { kind: "booked", template: "{title}" }));
    const panel = within(screen.getByTestId("widget-settings"));
    const kind = panel.getByRole("combobox", { name: "A sentence for each stop: kind" }) as HTMLSelectElement;
    expect(kind.value).toBe("booked");
    // `columns` is a table's; a sentence prints a detail instead.
    expect(panel.queryByText("Columns")).toBeNull();
    await userEvent.selectOptions(kind, "");
    await waitFor(() => expect(repeatAttrs(editor).params).toEqual({ template: "{title}" }));
  });

  // Review of #221: a token the collection does not publish prints as a gap on
  // the page, so the panel says which one while the author is still typing.
  it("names a detail the sentence asks for that the collection does not have", async () => {
    await openRepeat(repeatDoc("city.rows", { template: "{nme} in {name}" }));
    const sentence = screen.getByRole("textbox", { name: "Sentence" });
    // eslint-disable-next-line testing-library/no-node-access -- the warning is found by the id the input points at, which is the relationship under test.
    const warning = document.getElementById(sentence.getAttribute("aria-describedby") ?? "");
    expect(warning?.textContent).toBe("{nme} isn't a detail of each city, so the page leaves a gap there.");
    expect(lines()).toEqual(["— in Tokyo", "— in Kyoto"]);
    await userEvent.clear(sentence);
    // `{{` is user-event's escape for one typed `{`: this types "Hi {name}".
    await userEvent.type(sentence, "Hi {{name}");
    await waitFor(() => expect(lines()).toEqual(["Hi Tokyo", "Hi Kyoto"]));
    expect(sentence.getAttribute("aria-describedby")).toBeNull();
  });

  it("removes the sentence", async () => {
    const editor = await openRepeat(repeatDoc("day.rows", { template: "Day {date}" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove the sentence for each day" }));
    await waitFor(() => expect(editor.state.doc.child(0).type.name).toBe("paragraph"));
  });
});
