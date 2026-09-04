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
const withInputs = catalogue.find((w) => w.inputs.length > 0)!;
const withoutInputs = catalogue.find((w) => w.inputs.length === 0)!;

describe("WidgetSidebar", () => {
  it("lists every registered widget, by the name a person calls it", () => {
    render(<WidgetSidebar onInsert={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(catalogue.length);
    for (const w of catalogue) {
      expect(screen.getByRole("button", { name: new RegExp(w.title) })).toBeTruthy();
    }
  });

  it("narrows the list as you search, and says so when nothing matches", async () => {
    render(<WidgetSidebar onInsert={vi.fn()} />);
    const box = screen.getByRole("searchbox", { name: "Search widgets" });

    await userEvent.type(box, "budget");
    const shown = screen.getAllByRole("button");
    // Narrowed, not emptied, and not left whole — all three are ways this can
    // be wrong and only the middle one is right.
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(catalogue.length);
    expect(screen.getByRole("button", { name: /What's left of the budget/ })).toBeTruthy();

    await userEvent.clear(box);
    await userEvent.type(box, "zzzz");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/No widget matches/)).toBeTruthy();
  });

  // Someone who has read a document's JSON, or the assistant's tool surface,
  // knows a widget as `cost.day`. A search that could not find it would be
  // hiding the app's own vocabulary from the person using it.
  it("finds a widget by its stored name, not only by its title", async () => {
    render(<WidgetSidebar onInsert={vi.fn()} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search widgets" }), "cost.day");
    const shown = screen.getAllByRole("button");
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

  it("tags each row with its shape, in the catalogue's own words", () => {
    render(<WidgetSidebar onInsert={vi.fn()} />);
    const row = screen.getByRole("button", { name: /A day's stops/ });
    expect(within(row).getByText("a block")).toBeTruthy();
    const value = screen.getByRole("button", { name: /The trip's name/ });
    expect(within(value).getByText("one value")).toBeTruthy();
  });

  it("hands the editor a validated node for the widget that was clicked", async () => {
    const onInsert = vi.fn();
    render(<WidgetSidebar onInsert={onInsert} />);
    await userEvent.click(screen.getByRole("button", { name: /The trip's name/ }));
    expect(onInsert).toHaveBeenCalledWith({ type: "macro", attrs: { name: "trip.name", params: {} } });
  });
});
