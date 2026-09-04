import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import type { WidgetInput } from "@tc/pages";
import { WidgetChrome } from "./WidgetChrome";
import { STALE_DAY_VALUE, withDateRange } from "./widgetBind";

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
  it("renders one control per dimension the widget declares", () => {
    chrome({});
    // `stop.rows` declares all six dimensions (ADR-039's legality matrix gives
    // the STOP entity every one). Five get a control; `person` is the one that
    // does not, because `TripMember` has no display name and no stop carries a
    // person — a control there would be a choice that changes nothing except
    // turning the widget into "needs a person field" (decision 7).
    expect(screen.getByRole("combobox", { name: /a line for every stop: day/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /a line for every stop: tags/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /a line for every stop: city/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /a line for every stop: kind/i })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /who/i })).toBeNull();
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
    expect(optionsOf(/day/i)[0]).toBe("All days");
    expect(optionsOf(/city/i)[0]).toBe("All cities");
    expect(optionsOf(/kind/i)[0]).toBe("Any kind");
    expect(optionsOf(/tags/i)[0]).toBe("Every stop");
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

  it("gives a deleted day its own option, so picking All is a change the select reports", async () => {
    // The dead end this closes: a stale ref read back as `""`, so the control
    // already showed "All days" — and choosing it fired no change event, which
    // left the widget stuck on "that day was removed" with no way out but
    // editing the document by hand (Copilot, PR 141).
    const onChange = vi.fn();
    chrome({ day: { kind: "index", index: 9 } }, onChange);
    const day = screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement;
    // The control says the same thing the widget does, rather than contradicting it.
    expect(within(day).getByRole("option", { name: /removed/i })).toBeTruthy();
    expect(day.value).not.toBe("");
    await userEvent.selectOptions(day, "");
    // Cleared by removing the key, which is the one spelling of "every day".
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("writes nothing when the deleted-day option is re-picked", async () => {
    // It exists to be moved away from. Writing it back would be storing a
    // sentinel the contract has never heard of.
    const onChange = vi.fn();
    chrome({ day: { kind: "index", index: 9 }, tag: "meal" }, onChange);
    const day = screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement;
    await userEvent.selectOptions(day, day.value);
    for (const call of onChange.mock.calls) {
      expect(call[0]).toEqual({ day: { kind: "index", index: 9 }, tag: "meal" });
    }
  });

  it("offers a from/through pair for the date range rather than a select", async () => {
    const onChange = vi.fn();
    render(
      <WidgetChrome name="stop.rows" params={{}} detail={detail} globals={globals} onChange={onChange} />,
    );
    const from = screen.getByLabelText(/dates from/i);
    await userEvent.type(from, "2026-08-02");
    // One end typed is a single date, not a half-built range the contract would
    // refuse — `DateRangeRef` needs both ends and refuses a reversed one.
    expect(onChange).toHaveBeenLastCalledWith({ dates: { from: "2026-08-02", through: "2026-08-02" } });
  });

  it("writes a reversed range as typed rather than silently swapping the ends", () => {
    // Completing a half-filled control is not the same as reinterpreting a
    // filled one, and this used to sort both — so setting `from` after
    // `through` rewrote the author's input into a range they did not ask for
    // (Copilot, PR 141). The contract's own words: *"a reversed range is a
    // mistake somebody made, and quietly reinterpreting it is how a widget
    // shows a confident wrong answer."*
    //
    // The writer directly rather than through the control, because a date input
    // fires a change per keystroke and the assertion is about the RULE, not
    // about which partial value jsdom emits on the way to a full one.
    const dates: WidgetInput = { name: "dates", type: "dates", label: "Dates" };
    expect(withDateRange({ dates: { from: "2026-08-01", through: "2026-08-01" } }, dates, "through", "2026-07-01")).toEqual({
      dates: { from: "2026-08-01", through: "2026-07-01" },
    });
    // Completing a half-filled control still collapses to a single date, which
    // is the case that is NOT a reinterpretation.
    expect(withDateRange({}, dates, "through", "2026-07-01")).toEqual({
      dates: { from: "2026-07-01", through: "2026-07-01" },
    });
    // **Clearing EITHER end clears the filter**, which is what makes a date
    // filter removable at all: the completion rule above would otherwise refill
    // the box the reader just emptied from the one they left alone, and the
    // filter could never be taken off except by editing the document — the same
    // dead end the stale day select had, in the other control.
    const range = { dates: { from: "2026-07-01", through: "2026-08-01" } };
    expect(withDateRange(range, dates, "through", "")).toEqual({});
    expect(withDateRange(range, dates, "from", "")).toEqual({});
  });

  it("marks both ends invalid when the range is reversed, so the refusal is locatable", () => {
    chrome({ dates: { from: "2026-08-04", through: "2026-08-01" } });
    expect(screen.getByLabelText(/dates from/i).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/dates through/i).getAttribute("aria-invalid")).toBe("true");
    // And an ordinary range is not marked, or the signal means nothing.
    cleanup();
    chrome({ dates: { from: "2026-08-01", through: "2026-08-04" } });
    expect(screen.getByLabelText(/dates from/i).hasAttribute("aria-invalid")).toBe(false);
  });

  // THE reason this component changed. The old `onChange` replaced the whole
  // params object, so choosing a tag would have silently unbound the day — and
  // the widget would then say "no day set" while the day control still showed a
  // choice, a control contradicting the document it describes.
  it("setting one input preserves the other", async () => {
    const onChange = chrome({ day: { kind: "index", index: 1 } });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /tags/i }), "meal");
    expect(onChange).toHaveBeenCalledWith({ day: { kind: "index", index: 1 }, tag: "meal" });
  });

  it("clearing one input preserves the other, and clears by removing the key", async () => {
    const onChange = chrome({ day: { kind: "index", index: 1 }, tag: "meal" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /tags/i }), "");
    // `{}` is the one spelling of "not set up" (ADR-037 decision 6), so the key
    // is deleted rather than set to null or "".
    expect(onChange).toHaveBeenCalledWith({ day: { kind: "index", index: 1 } });
  });

  it("shows each input's current value, so the controls agree with the document", () => {
    chrome({ day: { kind: "index", index: 1 }, tag: "outdoors" });
    expect((screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement).value).toBe("1");
    expect((screen.getByRole("combobox", { name: /tags/i }) as HTMLSelectElement).value).toBe("outdoors");
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
    chrome({ day: { kind: "dayId", dayId: "33333333-3333-3333-3333-333333333333" } });
    expect((screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement).value).toBe("1");
  });

  // A stale binding reads as its OWN option, not as All — the widget beside it
  // says "that day was removed" and the control says the same, rather than
  // showing the choice that would fix it as though it were already made.
  // Guessing a real day here would be the control inventing a binding the
  // document does not have.
  it("reads a dayId for a day that no longer exists as the stale option", () => {
    chrome({ day: { kind: "dayId", dayId: "99999999-9999-9999-9999-999999999999" } });
    expect((screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement).value).toBe(STALE_DAY_VALUE);
  });

  it("reads an index past the end of the trip as the stale option", () => {
    chrome({ day: { kind: "index", index: 99 } });
    expect((screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement).value).toBe(STALE_DAY_VALUE);
  });

  it("reads NO binding as All days, which is the state that means every day", () => {
    // The distinction the stale option exists to preserve: absent is a real
    // answer, a broken pointer is not, and they must not read the same.
    chrome({});
    expect((screen.getByRole("combobox", { name: /day/i }) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("option", { name: /removed/i })).toBeNull();
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
    expect(screen.getByLabelText(/dates from/i)).toBeTruthy();
  });
});
