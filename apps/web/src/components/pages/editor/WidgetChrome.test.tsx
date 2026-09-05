import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { WidgetChrome } from "./WidgetChrome";

afterEach(cleanup);

// From the factory with the two days these cases need, rather than a
// hand-built `TripDetail` forced through `as unknown` — the cast hid contract
// drift from the type checker, and the repository rule is unqualified
// (AGENTS.md: "data comes from `@tc/factories`, never a hand-built rollup").
// Found by Copilot on PR 139.
const detail: TripDetail = tripDetailFixture({
  name: "Japan",
  startDate: "2026-08-01",
  days: [
    { dayId: "22222222-2222-2222-2222-222222222222", activityIds: [], date: "2026-08-01", costSubtotal: 0 },
    { dayId: "33333333-3333-3333-3333-333333333333", activityIds: [], date: "2026-08-02", costSubtotal: 0 },
  ],
});

const globals: TripGlobals = {
  days: [], cities: [],
  tags: [{ tag: "meal", activityCount: 2 }, { tag: "outdoors", activityCount: 1 }],
  bookedCount: 0,
};

const chrome = (params: Record<string, unknown>, onChange = vi.fn(), g: TripGlobals | null = globals) => {
  render(<WidgetChrome name="stop.rows" params={params} detail={detail} globals={g} onChange={onChange} />);
  return onChange;
};

describe("WidgetChrome renders a control per declared filter", () => {
  it("renders one control per dimension the widget declares, with days as ONE of them", () => {
    chrome({});
    // `stop.rows` declares all six dimensions (ADR-039's legality matrix gives
    // the STOP entity every one), and they reach the row as FOUR controls.
    //
    // `day` and `dates` are one control — Mitchell, on the preview: *"I dont
    // think we need the date pickers, and the dropdown for all days/specific
    // day, and the range. Combine them into one experience."* `person` is the
    // one dimension with no control at all, because `TripMember` has no display
    // name and no stop carries a person, so a control there would be a choice
    // that changes nothing except turning the widget into "needs a person
    // field" (decision 7).
    expect(screen.getByRole("combobox", { name: /a line for every stop: tags/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /a line for every stop: city/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /a line for every stop: kind/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /a line for every stop: dates/i })).toBeTruthy();
    // Three selects, not four: the day dropdown is gone into the days control.
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(screen.queryByRole("combobox", { name: /who/i })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /day/i })).toBeNull();
  });

  it("defaults the days control to All days, and opens the trip's own days", async () => {
    // ADR-039 decision 2 at the surface: nothing bound is the widest true
    // answer, and it says so in the words a person would use.
    chrome({});
    const days = screen.getByRole("button", { name: /dates/i });
    expect(days.textContent).toBe("All days");
    await userEvent.click(days);
    const grid = await screen.findByRole("group", { name: "Trip days" });
    // The trip's OWN days, numbered the way every other surface numbers them —
    // not a month calendar, which would need navigation and a concept of
    // "outside the trip" for a filter that is only ever over these.
    expect(within(grid).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Day 12026-08-01",
      "Day 22026-08-02",
    ]);
  });

  it("writes a single day as a range whose ends are equal", async () => {
    // `DateRangeRef`'s own shape for "a single date", so there is one stored
    // form rather than two — and it writes `dates`, never `day` (Mitchell's
    // call: one control writing two dimensions depending on how many cells you
    // touched is a rule nobody can predict from outside).
    const onChange = vi.fn();
    chrome({}, onChange);
    await userEvent.click(screen.getByRole("button", { name: /dates/i }));
    await userEvent.click(within(await screen.findByRole("group", { name: "Trip days" })).getByRole("button", { name: /Day 2/ }));
    expect(onChange).toHaveBeenLastCalledWith({ dates: { from: "2026-08-02", through: "2026-08-02" } });
  });

  it("takes two clicks as a range, in either direction", async () => {
    // Ordered here, where the two ends are two CLICKS rather than two typed
    // values: reaching backwards through a calendar is how ranges are picked
    // everywhere, and there is no "what the author typed" to preserve.
    const onChange = vi.fn();
    chrome({}, onChange);
    await userEvent.click(screen.getByRole("button", { name: /dates/i }));
    const grid = await screen.findByRole("group", { name: "Trip days" });
    await userEvent.click(within(grid).getByRole("button", { name: /Day 2/ }));
    await userEvent.click(within(grid).getByRole("button", { name: /Day 1/ }));
    expect(onChange).toHaveBeenLastCalledWith({ dates: { from: "2026-08-01", through: "2026-08-02" } });
  });

  it("clears back to All days, and takes a migrated `day` binding with it", async () => {
    // The dead end this closes. A document migrated from `cost.day` carries a
    // `day` ref (ADR-039's v1 → v2 step) that this control can no longer WRITE
    // — so it has to still be readable and clearable, or the migration would
    // strand every dated page ever written.
    const onChange = vi.fn();
    chrome({ day: { kind: "index", index: 1 }, tag: "meal" }, onChange);
    const days = screen.getByRole("button", { name: /dates/i });
    expect(days.textContent).toBe("Day 2");
    await userEvent.click(days);
    await userEvent.click(await screen.findByRole("button", { name: "All days" }));
    // Both keys removed, and the unrelated filter left alone.
    expect(onChange).toHaveBeenLastCalledWith({ tag: "meal" });
  });

  it("shows a deleted day as removed, and lets it be cleared", async () => {
    // The widget beside this renders "that day was removed"; this is where it
    // gets undone. Reading it as "All days" would show the choice that fixes it
    // as though it were already made, which is a control contradicting the
    // document.
    const onChange = vi.fn();
    chrome({ day: { kind: "index", index: 9 } }, onChange);
    const days = screen.getByRole("button", { name: /dates/i });
    expect(days.textContent).toBe("That day was removed");
    await userEvent.click(days);
    await userEvent.click(await screen.findByRole("button", { name: "All days" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("says a trip with no dates has nothing to filter by, rather than offering cells", async () => {
    // The stated cost of always writing `dates`: a date range resolves against
    // real dates, so on an undated trip there is nothing to select. Saying so is
    // the honest answer; offering day cells that stored a range matching nothing
    // would not be.
    render(
      <WidgetChrome
        name="stop.rows"
        params={{}}
        detail={tripDetailFixture({ name: "Undated", days: [] })}
        globals={globals}
        onChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /dates/i }));
    expect(await screen.findByText(/no dates yet/i)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Trip days" })).toBeNull();
    // And All days is still reachable, so an undated trip is never a dead end.
    expect(screen.getByRole("button", { name: "All days" })).toBeTruthy();
  });

  // Mitchell, on the preview, and the whole of ADR-039 decision 2 at the
  // surface a person touches: *"where we have a tool that you can select a day,
  // it can also select All at the top, and it gives you a sum."* It said "Not
  // set up", which was true of `cost.day` — that widget really was unbound with
  // no day — and is a lie about a primitive, where an unset day is every day.
  it("puts All at the top of every filter, as a named choice", () => {
    chrome({});
    const optionsOf = (name: RegExp) =>
      within(screen.getByRole("combobox", { name })).getAllByRole("option").map((o) => o.textContent);
    expect(optionsOf(/city/i)[0]).toBe("All cities");
    expect(optionsOf(/kind/i)[0]).toBe("Any kind");
    expect(optionsOf(/tags/i)[0]).toBe("Every stop");
    // The days control is a button, not a select, and says the same thing.
    expect(screen.getByRole("button", { name: /dates/i }).textContent).toBe("All days");
    expect(screen.queryByText("Not set up")).toBeNull();
  });

  // The kind select comes from the enum, not from a list copied into the
  // component: a sixth `ActivityKind` shows up here the day it exists.
  it("offers every ActivityKind, since a kind a trip lacks is still a real filter", () => {
    chrome({});
    const kinds = within(screen.getByRole("combobox", { name: /kind/i }))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(kinds).toEqual(["Any kind", "booked", "hold", "idea", "transit", "planned"]);
  });

  // §18's table: a tag input reads "every stop, or one", so unset is a real
  // answer with its own meaning rather than an unfilled blank. ADR-039
  // decision 2 generalises that to all five.
  it("words an unset tag as the answer it is, not as 'Not set up'", () => {
    chrome({});
    const tags = screen.getByRole("combobox", { name: /tags/i });
    expect(within(tags).getByRole("option", { name: "Every stop" })).toBeTruthy();
    expect((tags as HTMLSelectElement).value).toBe("");
  });

  it("offers the trip's tags in use, not every tag the enum has", () => {
    chrome({});
    const tags = screen.getByRole("combobox", { name: /tags/i });
    const options = within(tags).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Every stop", "meal", "outdoors"]);
    // "lodging" and "ticketed" are real ActivityTag members this trip does not
    // use. Offering them is a filter whose only outcome is an empty widget.
    expect(options).not.toContain("lodging");
  });

  it("still offers 'every stop' when the globals projection did not load", () => {
    chrome({}, vi.fn(), null);
    const tags = screen.getByRole("combobox", { name: /tags/i });
    expect(within(tags).getAllByRole("option").map((o) => o.textContent)).toEqual(["Every stop"]);
  });

  it("still offers 'all cities' when the globals projection did not load", () => {
    // Cities come only from `globals` — they are derived by `citiesOfDay` in
    // `@tc/domain`, which `@tc/pages` may not import — so without it the select
    // has one option and it is the honest one.
    chrome({}, vi.fn(), null);
    const cities = screen.getByRole("combobox", { name: /city/i });
    expect(within(cities).getAllByRole("option").map((o) => o.textContent)).toEqual(["All cities"]);
  });
});

// Both of these are the same failure from two directions: a control that
// disagrees with the document it describes. The reader believes the control, so
// this is worse than either state alone. Found by Copilot on PR 139.
describe("WidgetChrome shows what the document actually holds", () => {
  it("resolves a dayId binding to its day, rather than reading it as unset", () => {
    // `DayRef` has two shapes and the resolvers honour both, so a widget bound
    // by `dayId` — what a hand-edited document or an AI insert can carry —
    // rendered its day correctly while the control claimed it was unbound. A
    // control contradicting the document it describes is worse than either
    // state alone, because the reader believes the control (Copilot, PR 139).
    chrome({ day: { kind: "dayId", dayId: "33333333-3333-3333-3333-333333333333" } });
    expect(screen.getByRole("button", { name: /dates/i }).textContent).toBe("Day 2");
  });

  // Globals still loading, failed, or the last stop with that tag removed. The
  // native select would otherwise fall back to displaying "Every stop" while the
  // widget is still filtering by the saved tag.
  it("keeps a bound tag in the list when globals do not carry it", () => {
    chrome({ tag: "lodging" });
    const tags = screen.getByRole("combobox", { name: /tags/i });
    expect((tags as HTMLSelectElement).value).toBe("lodging");
    expect(within(tags).getAllByRole("option").map((o) => o.textContent)).toContain("lodging");
  });

  it("keeps a bound tag visible even with no globals at all", () => {
    chrome({ tag: "meal" }, vi.fn(), null);
    const tags = screen.getByRole("combobox", { name: /tags/i });
    expect((tags as HTMLSelectElement).value).toBe("meal");
  });
});

describe("WidgetChrome with other widgets", () => {
  it("renders nothing for a widget that binds nothing", () => {
    // `attribute` is the one: it reads a named field, and `LEGAL_FILTERS.trip`
    // is empty because there is no set behind a trip to narrow.
    const { container } = render(
      <WidgetChrome name="attribute" params={{ field: "trip.name" }} detail={detail} globals={globals} onChange={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders exactly the dimensions a narrower widget declares", () => {
    // `city.rows` is entity `city`, whose matrix row is `city` and `dates` —
    // no day, no tag, no kind. The controls are generated from that
    // declaration, so a widget cannot offer a filter its resolver ignores.
    render(<WidgetChrome name="city.rows" params={{}} detail={detail} globals={globals} onChange={vi.fn()} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: /city/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /a line for every city: dates/i })).toBeTruthy();
  });
});
