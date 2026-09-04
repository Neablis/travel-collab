import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { macroCatalog } from "@tc/pages";
import { WidgetSidebar } from "./WidgetSidebar";

// The sidebar reads the LIVE registry, so these assertions are written against
// `macroCatalog()` rather than against a list of names copied into this file.
// A copied list is the second registry all over again — the thing ADR-037
// deleted — and it would go stale the first time someone adds a widget.
const catalogue = macroCatalog();

// The widget rows, and ONLY those. The filter chips are buttons too, so
// `getAllByRole("button")` counts them — which silently turned "every widget is
// listed" into "every widget plus four" the moment filters landed. Scoped to the
// list so the two cannot be confused again.
const rows = () => within(screen.getByRole("list")).getAllByRole("button");
const withInputs = catalogue.find((w) => w.inputs.length > 0)!;
const withoutInputs = catalogue.find((w) => w.inputs.length === 0)!;

describe("WidgetSidebar", () => {
  it("lists every registered widget, by the name a person calls it", () => {
    render(<WidgetSidebar onInsert={vi.fn()} />);
    expect(rows()).toHaveLength(catalogue.length);
    for (const w of catalogue) {
      expect(screen.getByRole("button", { name: new RegExp(w.title) })).toBeTruthy();
    }
  });

  it("narrows the list as you search, and says so when nothing matches", async () => {
    render(<WidgetSidebar onInsert={vi.fn()} />);
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
  // hiding the app's own vocabulary from the person using it.
  it("finds a widget by its stored name, not only by its title", async () => {
    render(<WidgetSidebar onInsert={vi.fn()} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "cost.day");
    const shown = rows();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.textContent).toContain("What a day costs");
  });

  // The gate's "a mono line naming what it takes". A widget that lands unbound
  // is correct (ADR-037 decision 6 never defaults a day) and still surprising
  // if the row gave no warning, so the row says which before the click.
  it("says what a widget takes before it is inserted", () => {
    render(<WidgetSidebar onInsert={vi.fn()} />);
    const needsPointing = screen.getByRole("button", { name: new RegExp(withInputs.title) });
    expect(within(needsPointing).getByText(/point it at:/)).toBeTruthy();

    const standsAlone = screen.getByRole("button", { name: new RegExp(withoutInputs.title) });
    expect(within(standsAlone).getByText("ready as soon as it lands")).toBeTruthy();
  });

  // Named for WHEN you reach for one. "a block" describes the node, which is
  // the author's problem; "a section" describes where it lands, which is the
  // reader's (Mitchell, 2026-09-04).
  it("tags each row by where it lands in the page, not by its node type", () => {
    render(<WidgetSidebar onInsert={vi.fn()} />);
    expect(within(screen.getByRole("button", { name: /A day's stops/ })).getByText("a section")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /The trip's name/ })).getByText("in a sentence")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /A line for every day/ })).getByText("a line each")).toBeTruthy();
  });

  describe("filtering by kind", () => {
    const filters = () => screen.getByRole("group", { name: "Filter by kind" });

    it("starts on All, with every widget shown", () => {
      render(<WidgetSidebar onInsert={vi.fn()} />);
      expect(within(filters()).getByRole("button", { name: "All", pressed: true })).toBeTruthy();
      expect(rows()).toHaveLength(catalogue.length);
    });

    it("narrows to one kind, and every surviving row is of that kind", async () => {
      render(<WidgetSidebar onInsert={vi.fn()} />);
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
      render(<WidgetSidebar onInsert={vi.fn()} />);
      await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "day");
      await userEvent.click(within(filters()).getByRole("button", { name: "In a sentence" }));
      for (const row of rows()) {
        expect(row.textContent).toMatch(/in a sentence/);
      }
    });

    it("says the list is empty because of the kind, not because of a search", async () => {
      render(<WidgetSidebar onInsert={vi.fn()} />);
      await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "budget");
      await userEvent.click(within(filters()).getByRole("button", { name: "A line each" }));
      expect(screen.getByText(/No widget matches/)).toBeTruthy();
    });
  });

  it("hands the editor a validated node for the widget that was clicked", async () => {
    const onInsert = vi.fn();
    render(<WidgetSidebar onInsert={onInsert} />);
    await userEvent.click(screen.getByRole("button", { name: /The trip's name/ }));
    expect(onInsert).toHaveBeenCalledWith({ type: "macro", attrs: { name: "trip.name", params: {} } });
  });
});
