import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripDetail, PageContext, TripGlobals, UserPreferences } from "@tc/contracts";
import { getMacro, presetCatalog, renderMacro } from "@tc/pages";
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
  // Zero, and it used to be 12345 with no activities behind it — a rollup that
  // contradicted the stops it was supposedly a rollup OF. `cost.trip` read the
  // field and never noticed; `cost` sums the selected stops, which is what
  // makes it equal `tripCostTotal` on real data (`@tc/domain`'s `rollupCosts`
  // sums exactly those stops) and unequal on a fixture that made the number up.
  // The fixture was wrong, not the widget — AGENTS.md, "never a hand-built
  // rollup".
  tripCostTotal: 0,
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
  // Zero, for the same reason `tripCostTotal` above is: there is no unscheduled
  // stop here, so any other number is a rollup contradicting the stops it is a
  // rollup of. It said 500, which made the `$123.45` assertion below prove
  // nothing about a total — the fixture claimed 500 of unscheduled cost that
  // `cost` could not find and no reader could account for (CodeRabbit, PR 141).
  unscheduledCostSubtotal: 0,
  // And the trip's total is now the one stop on it, so the fixture agrees with
  // itself the way `rollupCosts` would make it agree on real data.
  tripCostTotal: 12345,
};

// The same trip with one stop left OFF a day, which is the case the fixture
// above used to gesture at with a number and no stop behind it.
//
// **The backlog is in an unfiltered answer, and that is a decision, not an
// accident**: ADR-039 decision 2 says an absent filter means everything, and a
// stop nobody has scheduled yet is still money the trip owes. `narrow` includes
// it exactly when no `day` and no `dates` filter is set — so this fixture is
// the only place the difference between "the whole trip" and "every scheduled
// day" is visible at this level.
const backloggedDetail: TripDetail = {
  ...costedDetail,
  activities: {
    ...costedDetail.activities,
    u1: {
      activityId: "u1", title: "Souvenirs", timeWindow: null,
      location: null, notes: null, anchors: [], kind: "idea", tags: [],
      cost: { amountMinor: 500, currency: "USD" },
    },
  },
  backlog: ["u1"],
  unscheduledCostSubtotal: 500,
  tripCostTotal: 12845,
};

describe("MacroView", () => {
  it("shows the formatted total for an unfiltered cost when there is a total", () => {
    render(<MacroView detail={costedDetail} context={ctx} name="cost" params={{}} />);
    expect(screen.getByText("$123.45")).toBeTruthy();
  });

  it("adds an unscheduled stop into the unfiltered total", () => {
    // The claim "no filters means the whole trip" is only testable where the
    // whole trip is more than its days. $123.45 + $5.00 — and a `cost` that
    // summed only scheduled stops, or read `tripCostTotal` off the projection
    // without summing anything, is told apart from the right answer here and
    // nowhere else in this file.
    render(<MacroView detail={backloggedDetail} context={ctx} name="cost" params={{}} />);
    expect(screen.getByText("$128.45")).toBeTruthy();
  });

  it("shows the 'no costs yet' chip when nothing is priced", () => {
    render(<MacroView detail={baseDetail} context={ctx} name="cost" params={{}} />);
    expect(screen.getByText("no costs yet")).toBeTruthy();
  });

  // These two are one assertion split in half: an unbound widget offers an
  // action when there IS one, and says so inertly when there is not. The single
  // test they replace asserted only the chip's text while calling it
  // "actionable", so it passed just as happily once `PageScreen` stopped
  // passing `onBindDay` and the chip became a button that did nothing.
  //
  // **The params are what changed under ADR-039, not the branch.** `{}` used to
  // be "no day set"; it is now every day, and the only way left to reach
  // `unbound: "day"` is a ref aimed at a day the trip no longer has. So both
  // bind a day past the end of a one-day trip — which is exactly what a
  // document says after someone deletes the day it pointed at.
  const staleDay = { day: { kind: "index", index: 9 } };

  it("offers an actionable chip for a deleted day when rebinding is possible", () => {
    render(<MacroView detail={baseDetail} context={ctx} name="cost" params={staleDay} onBindDay={() => {}} />);
    expect(screen.getByRole("button", { name: "that day was removed" })).toBeTruthy();
  });

  it("says the day was removed without offering a control when nothing can rebind", () => {
    render(<MacroView detail={baseDetail} context={ctx} name="cost" params={staleDay} />);
    expect(screen.getByText("that day was removed")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the trip's total for an EMPTY params object, rather than asking for a day", () => {
    // ADR-039 decision 2, at the surface a person sees: nothing bound is the
    // widest true answer, not a widget waiting to be pointed. This is the
    // assertion that would have caught the old "no day set" behaviour surviving
    // the change.
    render(<MacroView detail={costedDetail} context={ctx} name="cost" params={{}} />);
    expect(screen.queryByText("that day was removed")).toBeNull();
    expect(screen.getByText(/\$/)).toBeTruthy();
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
          <MacroView detail={baseDetail} context={ctx} name="day.rows" params={{}} />
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
      render(<MacroView detail={twoDays} context={ctx} name="day.rows" params={{}} />);
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
      render(<MacroView detail={costedDetail} context={ctx} name="cost" params={{}} />);
      expect(screen.getByText("$123.45").getAttribute("data-widget-value")).toBe("value");
    });

    it("marks a city as a city, so it can carry the trip's own colour for it", () => {
      const globals = {
        days: [{ index: 0, date: "2026-08-01", cities: ["Kyoto"], activityCount: 1, costSubtotal: 12345 }],
        cities: [{ name: "Kyoto", dayIndexes: [0], activityCount: 1 }],
        tags: [], bookedCount: 0,
      };
      render(<MacroView detail={costedDetail} context={ctx} globals={globals} name="day.rows" params={{}} />);
      expect(screen.getByText("Kyoto").getAttribute("data-widget-value")).toBe("city");
      // The date on the same line is an ordinary value. A renderer that marked
      // everything a city would colour a page uniformly and pass a test that
      // only looked at the city.
      expect(screen.getByText("Aug 1, 2026").getAttribute("data-widget-value")).toBe("value");
    });

    // The lead of `day.rows` is a label the widget wrote, not a value it
    // resolved, and marking it would claim the trip supplied the words
    // "Day 1".
    it("leaves a row's own label unmarked", () => {
      render(<MacroView detail={costedDetail} context={ctx} name="day.rows" params={{}} />);
      const lead = screen.getByText("Day 1");
      expect(lead.hasAttribute("data-widget-value")).toBe(false);
    });
  });

  // "Every day at a glance" used to stack a full `itinerary.day` card per day —
  // the widget beside it, repeated, with every stop's time and cost nested one
  // card inside another. Mitchell: *"The every day at a glance and every city
  // at a glance are not rendering correctly."* A glance is one row per day.
  describe("day.detail wide is a glance, not a stack of day cards", () => {
    // **Two days, and that is the point rather than fixture padding.** ADR-039
    // decision 1 makes a block's arity a fact about its SELECTION: one selected
    // day is one day's card, many are the glance table. A one-day trip is
    // therefore the wrong fixture for a test about the table — it exercises the
    // other branch — and the last test here, "says a day is empty", is exactly
    // the case where a single day answers `empty()` instead.
    const twoDays: TripDetail = {
      ...costedDetail,
      days: [costedDetail.days[0]!, { ...costedDetail.days[0]!, dayId: "d1", activityIds: [] }],
    };
    const threeStops: TripDetail = {
      ...twoDays,
      activities: {
        ...costedDetail.activities,
        a2: { ...costedDetail.activities.a1!, activityId: "a2", title: "Shrine" },
        a3: { ...costedDetail.activities.a1!, activityId: "a3", title: "Market" },
        a4: { ...costedDetail.activities.a1!, activityId: "a4", title: "Bar" },
      },
      days: [{ ...costedDetail.days[0]!, activityIds: ["a1", "a2", "a3", "a4"] }, twoDays.days[1]!],
    };

    it("gives each day one row, labelled by the day the trip counts it as", () => {
      render(<MacroView detail={twoDays} context={ctx} name="day.detail" params={{}} />);
      const rows = screen.getAllByRole("row");
      expect(rows).toHaveLength(2);
      expect(rows[0]!.textContent).toContain("Day 1");
      expect(rows[0]!.textContent).toContain("Museum");
      expect(rows[1]!.textContent).toContain("Day 2");
    });

    // The line names what the day IS. Naming every stop is the other widget's
    // job, and it is what made this one unreadable on a two-week trip.
    it("names three stops and counts the rest, rather than listing them all", () => {
      render(<MacroView detail={threeStops} context={ctx} name="day.detail" params={{}} />);
      const row = screen.getAllByRole("row")[0]!;
      expect(row.textContent).toContain("Museum · Shrine · Market · +1 more");
      expect(row.textContent).not.toContain("Bar");
    });

    // An empty cell in a bordered table reads as a rendering fault, which is
    // half of what "not rendering correctly" was.
    it("says a day is empty rather than rendering an empty cell", () => {
      render(<MacroView detail={twoDays} context={ctx} name="day.detail" params={{}} />);
      expect(screen.getByText("Nothing planned yet")).toBeTruthy();
    });

    // The other arity, and the one that keeps `itinerary.day`'s output intact
    // through the migration: pointed at a day, it is that day's card, not a
    // one-row table.
    it("is one day's card when the selection holds one day", () => {
      render(
        <MacroView
          detail={twoDays}
          context={ctx}
          name="day.detail"
          params={{ day: { kind: "index", index: 0 } }}
        />,
      );
      expect(screen.queryAllByRole("row")).toHaveLength(0);
      expect(screen.getByText("Museum")).toBeTruthy();
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
  // A preset's own filters, plus a day for anything that still asks for one, so
  // block widgets reach `ok` instead of a deleted-day chip.
  function boundParams(entry: { widget: string; params: Readonly<Record<string, unknown>> }): Record<string, unknown> {
    const params: Record<string, unknown> = { ...entry.params };
    for (const input of getMacro(entry.widget)?.inputs ?? []) {
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
    for (const widget of presetCatalog()) {
      const outcome = renderMacro(
        { trip: richDetail, page: ctx, user: richUser, globals: richGlobals },
        widget.widget,
        boundParams(widget),
      );
      expect(outcome.status, `${widget.name} did not resolve — its renderer never runs below`).toBe("ok");
    }
    expect(presetCatalog().length).toBeGreaterThan(10);
  });

  it("renders no block-level element inside a paragraph, for any widget in the registry", () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      for (const widget of presetCatalog()) {
        const { unmount } = render(
          <p>
            <MacroView
              detail={richDetail}
              context={ctx}
              user={richUser}
              globals={richGlobals}
              name={widget.widget}
              params={boundParams(widget)}
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
