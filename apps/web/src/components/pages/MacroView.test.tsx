import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripDetail, PageContext, TripGlobals, UserPreferences } from "@tc/contracts";
import { getMacro, macroCatalog, renderMacro } from "@tc/pages";
import { MacroView } from "./MacroView";

afterEach(cleanup);

const baseDetail: TripDetail = {
  tripId: "11111111-1111-1111-1111-111111111111",
  name: "Test Trip",
  startDate: null,
  currency: "USD",
  budget: null,
  members: [{ userId: "u1", role: "owner" }],
  forkedFrom: null,
  days: [{ dayId: "22222222-2222-2222-2222-222222222222", activityIds: [], date: null, costSubtotal: 0 }],
  backlog: [],
  activities: {},
  conflicts: [],
  dismissedConflictIds: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  unscheduledCostSubtotal: 0,
  tripCostTotal: 12345,
  budgetRemaining: null,
  status: "active",
};

const ctx: PageContext = { tripId: baseDetail.tripId };

// A trip with a costed, timed stop on a dated day, so the BLOCK widgets resolve
// to `ok` and actually render their markup — an `empty` chip would prove
// nothing about the shape of a rendered table.
const costedDetail: TripDetail = {
  ...baseDetail,
  startDate: "2026-08-01",
  days: [{ dayId: baseDetail.days[0]!.dayId, activityIds: ["a1"], date: "2026-08-01", costSubtotal: 12345 }],
  activities: {
    a1: {
      activityId: "a1", title: "Museum", timeWindow: { start: "09:00", end: "10:00" },
      location: null, notes: null, anchors: [], kind: "planned", tags: [],
      cost: { amountMinor: 12345, currency: "USD" },
    },
  },
  unscheduledCostSubtotal: 500,
};

describe("MacroView", () => {
  it("shows the formatted total for cost.trip when there is a total", () => {
    render(<MacroView detail={baseDetail} context={ctx} name="cost.trip" params={{}} />);
    expect(screen.getByText("$123.45")).toBeTruthy();
  });

  it("shows the 'no costs yet' chip for cost.trip when the total is zero", () => {
    const zeroDetail: TripDetail = { ...baseDetail, tripCostTotal: 0 };
    render(<MacroView detail={zeroDetail} context={ctx} name="cost.trip" params={{}} />);
    expect(screen.getByText("no costs yet")).toBeTruthy();
  });

  // These two are one assertion split in half: an unbound widget offers an
  // action when there IS one, and says so inertly when there is not. The single
  // test they replace asserted only the chip's text while calling it
  // "actionable", so it passed just as happily once `PageScreen` stopped
  // passing `onBindDay` and the chip became a button that did nothing.
  it("offers an actionable 'select a day' chip for cost.day when rebinding is possible", () => {
    render(<MacroView detail={baseDetail} context={ctx} name="cost.day" params={{}} onBindDay={() => {}} />);
    expect(screen.getByRole("button", { name: "select a day" })).toBeTruthy();
  });

  it("states 'no day set' without offering a control when nothing can rebind", () => {
    render(<MacroView detail={baseDetail} context={ctx} name="cost.day" params={{}} />);
    expect(screen.getByText("no day set")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  // The `rows` branch, which existed unexercised from the day the widget
  // framework landed until a repeater reached it.
  describe("a repeater's rows", () => {
    // A widget node is INLINE — it sits inside a paragraph so a chip can read
    // as a word in a sentence — so the rows have to be legal there. `<div>` in
    // `<p>` is not merely unusual: the parser closes the paragraph at it, and
    // the server's DOM and the client's then disagree. React says so outright,
    // and this is the test that heard it.
    it("renders rows that are legal inside a paragraph", () => {
      const warnings: string[] = [];
      const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        warnings.push(String(args[0]));
      });
      render(
        <p>
          <MacroView detail={baseDetail} context={ctx} name="day.line" params={{}} />
        </p>,
      );
      spy.mockRestore();
      expect(warnings.filter((w) => w.includes("cannot be a descendant") || w.includes("hydration"))).toEqual([]);
    });

    it("renders one line per day, each leading with the day number", () => {
      const twoDays: TripDetail = {
        ...baseDetail,
        days: [
          baseDetail.days[0]!,
          { dayId: "33333333-3333-3333-3333-333333333333", activityIds: [], date: null, costSubtotal: 0 },
        ],
      };
      render(<MacroView detail={twoDays} context={ctx} name="day.line" params={{}} />);
      // **One row per day, and each row carrying its own lead.** Asserting only
      // that both labels appear somewhere passes for a renderer that duplicates
      // a row or puts both leads in one (CodeRabbit, PR 139) — which is exactly
      // the bug "one line per day" is the claim about.
      const rows = screen.getAllByRole("listitem");
      expect(rows).toHaveLength(2);
      expect(rows[0]!.textContent).toContain("Day 1");
      expect(rows[1]!.textContent).toContain("Day 2");
      expect(rows[0]!.textContent).not.toContain("Day 2");
    });
  });

  // Mitchell, on the preview: *"A value coming from a widget in readonly mode
  // should be clearly coming from a widget."* In Reading there is no chrome
  // row and no bind control, so the value itself is the only thing left that
  // can say where it came from.
  //
  // `data-widget-value` is the non-presentational handle for that claim: the
  // treatment is a class the colour wall owns, and asserting classes is
  // forbidden here, but "which words on this page came from the trip" is a
  // question with a real answer.
  describe("a resolved value says it came from a widget", () => {
    it("marks the value, not the prose around it", () => {
      render(<MacroView detail={baseDetail} context={ctx} name="cost.trip" params={{}} />);
      expect(screen.getByText("$123.45").getAttribute("data-widget-value")).toBe("value");
    });

    it("marks a city as a city, so it can carry the trip's own colour for it", () => {
      const globals = {
        days: [{ index: 0, date: "2026-08-01", cities: ["Kyoto"], activityCount: 1, costSubtotal: 12345 }],
        cities: [{ name: "Kyoto", dayIndexes: [0], activityCount: 1 }],
        tags: [], bookedCount: 0,
      };
      render(<MacroView detail={costedDetail} context={ctx} globals={globals} name="day.line" params={{}} />);
      expect(screen.getByText("Kyoto").getAttribute("data-widget-value")).toBe("city");
      // The date on the same line is an ordinary value. A renderer that marked
      // everything a city would colour a page uniformly and pass a test that
      // only looked at the city.
      expect(screen.getByText("Aug 1, 2026").getAttribute("data-widget-value")).toBe("value");
    });

    // The lead of `day.line` is a label the widget wrote, not a value it
    // resolved, and marking it would claim the trip supplied the words
    // "Day 1".
    it("leaves a row's own label unmarked", () => {
      render(<MacroView detail={costedDetail} context={ctx} name="day.line" params={{}} />);
      const lead = screen.getByText("Day 1");
      expect(lead.hasAttribute("data-widget-value")).toBe(false);
    });
  });

  // "Every day at a glance" used to stack a full `itinerary.day` card per day —
  // the widget beside it, repeated, with every stop's time and cost nested one
  // card inside another. Mitchell: *"The every day at a glance and every city
  // at a glance are not rendering correctly."* A glance is one row per day.
  describe("itinerary.trip is a glance, not a stack of day cards", () => {
    const threeStops: TripDetail = {
      ...costedDetail,
      activities: {
        ...costedDetail.activities,
        a2: { ...costedDetail.activities.a1!, activityId: "a2", title: "Shrine" },
        a3: { ...costedDetail.activities.a1!, activityId: "a3", title: "Market" },
        a4: { ...costedDetail.activities.a1!, activityId: "a4", title: "Bar" },
      },
      days: [{ ...costedDetail.days[0]!, activityIds: ["a1", "a2", "a3", "a4"] }],
    };

    it("gives each day one row, labelled by the day the trip counts it as", () => {
      render(<MacroView detail={costedDetail} context={ctx} name="itinerary.trip" params={{}} />);
      const rows = screen.getAllByRole("row");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.textContent).toContain("Day 1");
      expect(rows[0]!.textContent).toContain("Museum");
    });

    // The line names what the day IS. Naming every stop is the other widget's
    // job, and it is what made this one unreadable on a two-week trip.
    it("names three stops and counts the rest, rather than listing them all", () => {
      render(<MacroView detail={threeStops} context={ctx} name="itinerary.trip" params={{}} />);
      const row = screen.getAllByRole("row")[0]!;
      expect(row.textContent).toContain("Museum · Shrine · Market · +1 more");
      expect(row.textContent).not.toContain("Bar");
    });

    // An empty cell in a bordered table reads as a rendering fault, which is
    // half of what "not rendering correctly" was.
    it("says a day is empty rather than rendering an empty cell", () => {
      render(<MacroView detail={baseDetail} context={ctx} name="itinerary.trip" params={{}} />);
      expect(screen.getByText("Nothing planned yet")).toBeTruthy();
    });
  });
});

// **Every widget must be legal inside a paragraph, because that is where every
// widget goes.** `MacroNodeExtension` is an inline atom, so a widget node sits
// in the text flow — and a block-level element there is not merely unusual
// markup: the HTML parser closes the paragraph at a `<div>` and hoists a
// `<table>` out of it entirely, so the server's DOM and the client's disagree.
//
// It was measured once, on the repeater's rows, and fixed only there: all three
// BLOCK widgets kept rendering `<div>`, `<ul>` and a real `<table>` until
// Copilot found them on PR 139. This is registry-wide so the next widget is
// covered the day it lands, rather than the next time someone reads a React
// warning in a console nobody was watching.
//
// It asserts through React's own nesting validation rather than by inspecting
// tag names, which the test-quality wall forbids reaching for — and which is
// the right call here anyway: the claim is "the browser will accept this", and
// React's validator is the thing that answers it.
describe("every widget is legal where widgets actually go", () => {
  // **A widget whose renderer never ran cannot emit bad markup, so a fixture
  // that leaves widgets unbound tests nothing.** With `params={{}}` every
  // day-input widget resolved `unbound` and `MacroView` returned an `EmptyChip`
  // before reaching the renderer — so ten of the seventeen entries were walked
  // without their markup ever being produced (CodeRabbit, PR 139). The two that
  // did run are the two that carried the bug, which is why it was caught at all
  // and not why the test was sound.
  //
  // Params are built FROM each widget's declared inputs rather than typed per
  // widget, so the seventeenth widget is bound the day it lands. An unset `tags`
  // is deliberately left unset: §18 makes "no tag" mean every stop, so that IS
  // the bound case.
  function boundParams(name: string): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const input of getMacro(name)?.inputs ?? []) {
      if (input.type === "day") params[input.name] = { kind: "index", index: 0 };
    }
    return params;
  }

  // Rich enough that every widget resolves: a budget, a booked stop as well as a
  // planned one, a city projection and an account.
  const richDetail: TripDetail = {
    ...costedDetail,
    budget: { amountMinor: 50000, currency: "USD" },
    budgetRemaining: 37655,
    days: [{ ...costedDetail.days[0]!, activityIds: ["a1", "booked"] }],
    activities: {
      ...costedDetail.activities,
      booked: {
        activityId: "booked", title: "Ryokan", timeWindow: { start: "15:00", end: "23:00" },
        location: null, notes: null, anchors: [], kind: "booked", tags: [],
        cost: { amountMinor: 12000, currency: "USD" },
      },
    },
  };
  const richGlobals: TripGlobals = {
    days: [{ index: 0, date: "2026-08-01", cities: ["Kyoto"], activityCount: 2, costSubtotal: 12345 }],
    cities: [{ name: "Kyoto", dayIndexes: [0], activityCount: 2 }],
    tags: [], bookedCount: 1,
  };
  const richUser: UserPreferences = { displayName: "Priya", homeAirport: "SFO", distanceUnit: "km" };

  it("resolves every widget in the registry against this fixture", () => {
    // The witness for the test below, and a real assertion in its own right: if
    // one entry stops resolving here, the nesting walk quietly stops covering
    // it, and this is the line that says so by name.
    for (const widget of macroCatalog()) {
      const outcome = renderMacro(
        { trip: richDetail, page: ctx, user: richUser, globals: richGlobals },
        widget.name,
        boundParams(widget.name),
      );
      expect(outcome.status, `${widget.name} did not resolve — its renderer never runs below`).toBe("ok");
    }
    expect(macroCatalog().length).toBeGreaterThan(10);
  });

  it("renders no block-level element inside a paragraph, for any widget in the registry", () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      for (const widget of macroCatalog()) {
        const { unmount } = render(
          <p>
            <MacroView
              detail={richDetail}
              context={ctx}
              user={richUser}
              globals={richGlobals}
              name={widget.name}
              params={boundParams(widget.name)}
            />
          </p>,
        );
        unmount();
      }
    } finally {
      spy.mockRestore();
    }
    const nesting = errors.filter((e) => /cannot be a descendant of|cannot contain a nested/i.test(e));
    expect(nesting, `block-level markup inside <p>:\n${nesting.join("\n")}`).toEqual([]);
  });
});
