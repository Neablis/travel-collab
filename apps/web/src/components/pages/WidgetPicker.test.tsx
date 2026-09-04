import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { presetCatalog } from "@tc/pages";
import { WidgetPicker } from "./WidgetPicker";

// The picker reads the LIVE preset list, so these assertions are written
// against `presetCatalog()` rather than against a list of names copied into
// this file. A copied list is the second registry all over again — the thing
// ADR-037 deleted — and it would go stale the first time someone adds a preset.
const catalogue = presetCatalog();

// The widget rows, and ONLY those. The filter chips are buttons too, so
// `getAllByRole("button")` counts them — which silently turned "every widget is
// listed" into "every widget plus four" the moment filters landed. Scoped to the
// list so the two cannot be confused again.
const rows = () => within(screen.getByRole("list")).getAllByRole("button");
const withInputs = catalogue.find((w) => w.inputs.length > 0)!;
const withoutInputs = catalogue.find((w) => w.inputs.length === 0)!;

describe("WidgetPicker", () => {
  it("lists every preset, by the name a person calls it", () => {
    render(<WidgetPicker onPick={vi.fn()} />);
    expect(rows()).toHaveLength(catalogue.length);
    for (const w of catalogue) {
      expect(screen.getByRole("button", { name: new RegExp(w.title) })).toBeTruthy();
    }
  });

  it("narrows the list as you search, and says so when nothing matches", async () => {
    render(<WidgetPicker onPick={vi.fn()} />);
    const box = screen.getByRole("searchbox", { name: "Search widgets" });

    await userEvent.type(box, "budget");
    const shown = rows();
    // Narrowed, not emptied, and not left whole — all three are ways this can
    // be wrong and only the middle one is right.
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(catalogue.length);
    expect(screen.getByRole("button", { name: /What's left of the budget/ })).toBeTruthy();

    await userEvent.clear(box);
    await userEvent.type(box, "zzzz");
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/No widget matches/)).toBeTruthy();
  });

  // Someone who has read a document's JSON, or the assistant's tool surface,
  // knows a widget as `cost.day`. A search that could not find it would be
  // hiding the app's own vocabulary from the person using it — and `cost.day`
  // is now a RETIRED name, which makes the point sharper rather than moot: the
  // preset list is where it went, and §6 says it has to still be findable.
  it("finds a preset by a retired widget name, not only by its title", async () => {
    render(<WidgetPicker onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "cost.day");
    const shown = rows();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.textContent).toContain("What it costs");
  });

  // §6's other half: *"every word in the query must match something, so 'day
  // cost' finds `cost`. Today it finds nothing."* The words are in two
  // different fields, so a single-substring match over each field in turn
  // cannot find it however many fields it searches.
  it("matches every word of the query, across fields", async () => {
    render(<WidgetPicker onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "day cost");
    const shown = rows();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.some((row) => row.textContent?.includes("What it costs"))).toBe(true);
  });

  // Keywords are what somebody types when they do not know the title. "spend"
  // appears in no title, no description and no id.
  it("finds a preset by a keyword that appears nowhere on the row", async () => {
    render(<WidgetPicker onPick={vi.fn()} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "spend");
    const shown = rows();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.some((row) => row.textContent?.includes("What it costs"))).toBe(true);
  });

  // The gate's "a mono line naming what it takes". Under ADR-039 decision 2 a
  // widget that lands with nothing bound is showing EVERYTHING rather than
  // waiting, so the line says what you can narrow it by rather than warning
  // that it wants pointing.
  it("says what a widget can be narrowed by before it is inserted", () => {
    render(<WidgetPicker onPick={vi.fn()} />);
    const needsPointing = screen.getByRole("button", { name: new RegExp(withInputs.title) });
    expect(within(needsPointing).getByText(/narrow it by:/)).toBeTruthy();

    const standsAlone = screen.getByRole("button", { name: new RegExp(withoutInputs.title) });
    expect(within(standsAlone).getByText("ready as soon as it lands")).toBeTruthy();
  });

  // Named for WHEN you reach for one. "a block" describes the node, which is
  // the author's problem; "a section" describes where it lands, which is the
  // reader's (Mitchell, 2026-09-04).
  it("tags each row by where it lands in the page, not by its node type", () => {
    render(<WidgetPicker onPick={vi.fn()} />);
    expect(within(screen.getByRole("button", { name: /The days, in detail/ })).getByText("a section")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /The trip's name/ })).getByText("in a sentence")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /A line for every day/ })).getByText("a line each")).toBeTruthy();
  });

  describe("filtering by kind", () => {
    const filters = () => screen.getByRole("group", { name: "Filter by kind" });

    it("starts on All, with every widget shown", () => {
      render(<WidgetPicker onPick={vi.fn()} />);
      expect(within(filters()).getByRole("button", { name: "All", pressed: true })).toBeTruthy();
      expect(rows()).toHaveLength(catalogue.length);
    });

    it("narrows to one kind, and every surviving row is of that kind", async () => {
      render(<WidgetPicker onPick={vi.fn()} />);
      await userEvent.click(within(filters()).getByRole("button", { name: "A line each" }));
      const shown = rows();
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.length).toBeLessThan(catalogue.length);
      // Not just "fewer" — every one of them is a repeater. A filter that drops
      // the right count while keeping a wrong row is the failure worth catching.
      const repeats = catalogue.filter((w) => w.shape === "repeat").map((w) => w.title);
      for (const row of shown) {
        expect(repeats.some((t) => row.textContent?.includes(t))).toBe(true);
      }
    });

    // The two narrow independently, or a filter would silently widen a search.
    it("combines with the search box rather than replacing it", async () => {
      render(<WidgetPicker onPick={vi.fn()} />);
      await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "day");
      await userEvent.click(within(filters()).getByRole("button", { name: "In a sentence" }));
      const shown = rows();
      // The witness. A `for` over an empty list asserts nothing, so a
      // regression that made the two filters INTERSECT to nothing — which is
      // exactly what "replacing rather than combining" would look like from one
      // side — passed this test (CodeRabbit, PR 139).
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.length).toBeLessThan(catalogue.length);
      for (const row of shown) {
        expect(row.textContent).toMatch(/in a sentence/);
      }
    });

    it("says the list is empty because of the kind, not because of a search", async () => {
      render(<WidgetPicker onPick={vi.fn()} />);
      await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "budget");
      await userEvent.click(within(filters()).getByRole("button", { name: "A line each" }));
      expect(screen.getByText(/No widget matches/)).toBeTruthy();
    });
  });

  // The picker names a widget; it never builds a node. That split is what lets
  // the popover, the phone sheet and the slash menu share it — and it is why
  // `insertWidget` stays the one construction path (ADR-037 decision 4).
  it("reports the STORED name of the widget that was clicked, not its title", async () => {
    const onPick = vi.fn();
    render(<WidgetPicker onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /The trip's name/ }));
    expect(onPick).toHaveBeenCalledWith("trip.name");
  });

  // Drag is the same insert from a different origin, so the row has to be
  // draggable where a drop is possible — and must not be on a phone, where a
  // draggable row inside a scrolling sheet fights the scroll.
  it("is draggable only where dropping is possible", () => {
    const { unmount } = render(<WidgetPicker onPick={vi.fn()} draggable />);
    expect(screen.getByRole("button", { name: /The trip's name/ }).getAttribute("draggable")).toBe("true");
    unmount();

    render(<WidgetPicker onPick={vi.fn()} />);
    expect(screen.getByRole("button", { name: /The trip's name/ }).getAttribute("draggable")).not.toBe("true");
  });
});
