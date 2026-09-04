import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripDetail, PageContext } from "@tc/contracts";
import { macroCatalog } from "@tc/pages";
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
  it("renders no block-level element inside a paragraph, for any widget in the registry", () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      for (const widget of macroCatalog()) {
        const { unmount } = render(
          <p>
            <MacroView detail={costedDetail} context={ctx} name={widget.name} params={{}} />
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
