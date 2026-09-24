import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { presetCatalog } from "@tc/pages";
import { KIND_CELL_ON_GROUND, WidgetPicker, glyphCellFill } from "./WidgetPicker";

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

// **The one thing about this surface no rendered assertion can hold.** The kind
// icons are a picture drawn out of two fills — solid for the shape, faded for
// what is around it — sitting on a cell that changes ground when chosen. Get the
// faded fill wrong and the picture half-disappears, which is a paint, and the
// test-quality wall rejects `toHaveClass` outside `src/components/ui`.
//
// So the RULE is a function and the function is what gets asserted. No DOM, no
// classes on an element, just: these two may never be the same token.
//
// It shipped broken on 2026-09-20 — `fade` resolved to `bg-brand-tint` on a
// `bg-brand-tint` ground, so a selected Inline showed one pill and a selected
// List showed a vertical `⋮` that reads as a kebab menu. A browser walk of the
// preview caught it by reading computed `background-color`; nothing in this
// repo could.
describe("the kind icons stay legible in the state they exist to confirm", () => {
  it("never fills a faded glyph cell with the ground its own cell is painting", () => {
    expect(glyphCellFill("fade", true)).not.toBe(KIND_CELL_ON_GROUND);
  });

  // The other half, and not redundant: a fix that made every cell solid would
  // satisfy the rule above while destroying the distinction the picture is made
  // of. Faded and solid have to stay different from each other too, in BOTH
  // states — an unselected cell has its own (transparent) ground and the same
  // two-tier reading.
  it("keeps faded and solid distinct in both states", () => {
    expect(glyphCellFill("fade", true)).not.toBe(glyphCellFill(1, true));
    expect(glyphCellFill("fade", false)).not.toBe(glyphCellFill(1, false));
  });

  // A `dot` is a solid cell with a fixed width, so it follows the solid fill —
  // if it ever stopped doing so, a List row's lead dot would part company with
  // the bars beside it.
  it("draws a lead dot as solid, like the shape it leads", () => {
    expect(glyphCellFill("dot", true)).toBe(glyphCellFill(1, true));
    expect(glyphCellFill("dot", false)).toBe(glyphCellFill(1, false));
  });
});

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

  // **The count is the header's whole reason to exist, so it is asserted
  // against the list rather than against a number.** `22 widgets` typed into
  // this file is the copied-catalogue mistake the header comment already warns
  // about — it would pass while counting the wrong thing, and go stale on the
  // next preset. Asserting `rows().length` makes the claim "the line agrees
  // with what is on screen", which is the claim.
  //
  // The second half is what makes it worth writing at all: the line has to
  // follow the filters. A count that is right on first paint and stale after a
  // search is worse than no count — a person reads "22 widgets" over a list of
  // three and trusts the wrong one.
  it("counts what is actually listed, and keeps counting as the search narrows it", async () => {
    render(<WidgetPicker onPick={vi.fn()} />);
    expect(screen.getByText(new RegExp(`^${rows().length} widgets \u00b7`))).toBeTruthy();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "budget");
    const narrowed = rows().length;
    expect(narrowed).toBeLessThan(catalogue.length);
    expect(screen.getByText(new RegExp(`^${narrowed} widgets? \u00b7`))).toBeTruthy();
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

  // Mitchell, PR #221 preview: "A line for every day / city / stop" became one
  // row, "A line for each…", its collection picked in its settings. Whoever
  // types the collection they want still has to land on it — and `booking`
  // (the slash menu's `/booking`, which reads this same match) still finds the
  // booking shortcut, which stayed a row of its own.
  it("finds the one line-for-each row by any collection, and the booking row by booking", async () => {
    render(<WidgetPicker onPick={vi.fn()} />);
    const box = screen.getByRole("searchbox", { name: "Search widgets" });
    for (const query of ["day", "stop", "city", "stop.line", "city.line"]) {
      await userEvent.clear(box);
      await userEvent.type(box, query);
      expect(screen.getAllByRole("button", { name: /A line for each/ }), `"${query}"`).toHaveLength(1);
    }
    await userEvent.clear(box);
    await userEvent.type(box, "booking");
    expect(screen.getByRole("button", { name: /A line for every booking/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /A line for every (day|stop|city)/ })).toBeNull();
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
    expect(within(needsPointing).getByText(/^takes /)).toBeTruthy();

    const standsAlone = screen.getByRole("button", { name: new RegExp(withoutInputs.title) });
    expect(within(standsAlone).getByText("takes nothing \u2014 goes straight in")).toBeTruthy();
  });

  // Named for WHEN you reach for one. "a block" describes the node, which is
  // the author's problem; "a section" describes where it lands, which is the
  // reader's (Mitchell, 2026-09-04).
  // **The chip still says the SHAPE, in the design's shorter words.** It read
  // "a section" / "in a sentence" / "a line each" — Mitchell's 2026-09-04
  // answer to a vocabulary written for the author. The design answers it with
  // the ICON in the filter above plus a `title` carrying the full sentence, so
  // the chip goes back to one or two words and the row gets its width back.
  // What this test holds is unchanged: three shapes, three distinct chips, and
  // none of them the node type.
  it("tags each row by the shape it lands as, not by its node type", () => {
    render(<WidgetPicker onPick={vi.fn()} />);
    expect(within(screen.getByRole("button", { name: /The days, in detail/ })).getByText("a block")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /The trip's name/ })).getByText("inline")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /A line for each/ })).getByText("a list")).toBeTruthy();
  });

  describe("filtering by kind", () => {
    // **A radiogroup now, not a pressed-button group.** Exactly one kind is on
    // at a time, and the design's four-up icon control says so with the role
    // rather than with `aria-pressed` on four independent toggles.
    const filters = () => screen.getByRole("radiogroup", { name: "How it reads" });

    it("starts on All, with every widget shown", () => {
      render(<WidgetPicker onPick={vi.fn()} />);
      expect(within(filters()).getByRole("radio", { name: "All", checked: true })).toBeTruthy();
      expect(rows()).toHaveLength(catalogue.length);
    });

    it("narrows to one kind, and every surviving row is of that kind", async () => {
      render(<WidgetPicker onPick={vi.fn()} />);
      await userEvent.click(within(filters()).getByRole("radio", { name: "List" }));
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
      await userEvent.click(within(filters()).getByRole("radio", { name: "Inline" }));
      const shown = rows();
      // The witness. A `for` over an empty list asserts nothing, so a
      // regression that made the two filters INTERSECT to nothing — which is
      // exactly what "replacing rather than combining" would look like from one
      // side — passed this test (CodeRabbit, PR 139).
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.length).toBeLessThan(catalogue.length);
      for (const row of shown) {
        expect(row.textContent).toMatch(/inline/);
      }
    });

    // **A radiogroup is one tab stop moved through with the arrows** (WAI-ARIA),
    // and this was four tab stops with no arrows — `role="radio"` promising a
    // behaviour the control did not have. CodeRabbit, PR 198.
    //
    // Asserted through what a keyboard actually does, not through `tabIndex`
    // attributes: press the key, see the selection and the list move. The
    // roving half is asserted separately below, because "only one is tabbable"
    // is the part a key press cannot show.
    it("moves between kinds with the arrow keys, and wraps at both ends", async () => {
      render(<WidgetPicker onPick={vi.fn()} />);
      const group = within(filters());
      group.getByRole("radio", { name: "All" }).focus();

      await userEvent.keyboard("{ArrowRight}");
      expect(group.getByRole("radio", { name: "Inline", checked: true })).toBeTruthy();
      // The list follows the selection — otherwise the arrows would move a
      // highlight around without filtering anything.
      expect(rows().length).toBeLessThan(catalogue.length);

      await userEvent.keyboard("{End}");
      expect(group.getByRole("radio", { name: "List", checked: true })).toBeTruthy();

      // Wrapping, in the direction that used to give `-1 % 4 === -1`.
      await userEvent.keyboard("{ArrowRight}");
      expect(group.getByRole("radio", { name: "All", checked: true })).toBeTruthy();
      await userEvent.keyboard("{ArrowLeft}");
      expect(group.getByRole("radio", { name: "List", checked: true })).toBeTruthy();

      await userEvent.keyboard("{Home}");
      expect(group.getByRole("radio", { name: "All", checked: true })).toBeTruthy();
      expect(rows()).toHaveLength(catalogue.length);
    });

    // The other half of the ARIA contract: the group is ONE stop in the tab
    // order, so tabbing past it must not walk through four controls. Asserted
    // as "one tabbable radio, and it is the chosen one" — the property the
    // roving index exists to keep, rather than the attribute that implements it.
    it("is a single tab stop, on whichever kind is chosen", async () => {
      render(<WidgetPicker onPick={vi.fn()} />);
      const tabbable = () =>
        within(filters())
          .getAllByRole("radio")
          .filter((r) => r.tabIndex === 0);

      expect(tabbable()).toHaveLength(1);
      expect(tabbable()[0]!.textContent).toContain("All");

      await userEvent.click(within(filters()).getByRole("radio", { name: "Block" }));
      expect(tabbable()).toHaveLength(1);
      expect(tabbable()[0]!.textContent).toContain("Block");
    });

    it("says the list is empty because of the kind, not because of a search", async () => {
      render(<WidgetPicker onPick={vi.fn()} />);
      await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "budget");
      await userEvent.click(within(filters()).getByRole("radio", { name: "List" }));
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
