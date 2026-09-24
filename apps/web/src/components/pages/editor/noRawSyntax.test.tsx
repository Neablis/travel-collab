import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scenarios } from "@tc/factories";
import { MACRO_NAMES, PRESETS } from "@tc/pages";
import { newPageDoc, type MacroNode, type TripGlobals } from "@tc/contracts";
import {
  RAW_SYNTAX,
  SEGMENT_NAME_LEAK,
  STORED_IDENTIFIERS,
  WIDGET_PRESETS,
  everyRepeat,
  everyRepeatPage,
  everyWidget,
  everyWidgetPage,
  rawSyntaxLeaks,
} from "@/test-support/rawSyntax";
import { PageEditor } from "./PageEditor";
import { ReadOnlyPageDoc } from "./ReadOnlyPageDoc";

// The M14 gate box *"No user-visible macro syntax anywhere, in either mode"*,
// at the document: both modes of the editor, and the read-only fallback. What
// counts as syntax, and why, is in `test-support/rawSyntax.ts`; the screen
// around the document (the insert rail, a widget's settings) is covered in
// `PageScreen.test.tsx` with the same detector.
//
// A stored widget this build does not know, or whose params no longer parse, is
// covered too: `MacroView` used to print `unknown macro: <name>` /
// `bad params: <name>` for those, which is the stored name on the screen.

// A chart's code is lazy (`SpendByDayBlock`); until it arrives only its
// placeholder is on the page, and a sweep that ends there scans the placeholder,
// not the chart. Loaded up front so waiting for the drawn chart is waiting on
// React rather than on a cold transform of Recharts — the same reason, and the
// same measured failure, as `MacroView.test.tsx`'s nesting sweep.
beforeAll(async () => {
  await import("../blocks/SpendByDayChart");
});
/** Every lazily-drawn chart on the page has been drawn. */
const chartsDrawn = () => expect(screen.queryAllByRole("img", { busy: true })).toEqual([]);

beforeEach(() => {
  // jsdom has no layout engine; the same stubs `PageEditor.test.tsx` uses.
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

const widgets = everyWidget();
const doc = everyWidgetPage();
const trip = scenarios.threeDayTrip({ startDate: "2027-06-01" });
const context = { tripId: trip.tripId };
const user = { displayName: "Alice", homeAirport: "LIS", distanceUnit: "km" as const };
const repeats = everyRepeat();
const repeatPage = everyRepeatPage();
// Two cities, so a sentence for every city has lines to print.
const globals: TripGlobals = {
  days: trip.days.map((day, index) => ({
    index, date: day.date, cities: [index === 0 ? "Lisbon" : "Porto"], activityCount: day.activityIds.length,
    costSubtotal: day.costSubtotal, place: null, timeZone: null,
  })),
  cities: [
    { name: "Lisbon", dayIndexes: [0], activityCount: 2 },
    { name: "Porto", dayIndexes: [1, 2], activityCount: 4 },
  ],
  tags: [], bookedCount: 0, homeTimeZone: null,
};

describe("no macro syntax reaches the DOM", () => {
  // The witnesses: the guard is only worth anything if the page it scans
  // really holds every widget, and if every pattern can match.
  it("covers every preset and every registered widget, and each pattern can fire", () => {
    expect(widgets.length).toBe(WIDGET_PRESETS.length + MACRO_NAMES.length);
    // Every preset is a widget or the one sentence preset, and the sentences
    // cover every collection it can be pointed at.
    expect(WIDGET_PRESETS.length + 1).toBe(PRESETS.length);
    expect(repeats.map((r) => r.attrs.name).sort()).toEqual(["city.rows", "day.rows", "stop.rows"]);
    expect(STORED_IDENTIFIERS).toEqual(expect.arrayContaining(["cost.rows", "day.detail", "trip.countdown"]));

    // Every category fires on a sample of itself, on text and on an attribute.
    const probe = document.createElement("p");
    probe.textContent = 'day.detail {{cost}} [[Kyoto]] @cost(day=1) {"dates":{}} [object Object] Welcome to {name}';
    probe.title = "unknown macro: stop.rows";
    // A chip's segment name as its tooltip, the way `MacroView` once set it.
    const chip = document.createElement("span");
    chip.title = "value";
    probe.append(chip);
    const categories = new Set(rawSyntaxLeaks(probe).map((l) => l.split(" — ")[0]));
    expect([...categories].sort()).toEqual(
      [
        "stored identifier day.detail",
        "stored identifier stop.rows",
        SEGMENT_NAME_LEAK,
        ...RAW_SYNTAX.filter(([what]) => !what.startsWith("stored identifier")).map(([what]) => what),
      ].sort(),
    );
    // …and none fires on prose a page legitimately holds, or the guard would be
    // tuned down the first time it cried wolf — a sentence's escaped braces and
    // an unknown key included, which print as the author wrote them.
    const prose = document.createElement("p");
    prose.textContent = "Day 1 · 2027-06-01 — Kyoto, $1,200.00 of the cost; 3 stops, 2 booked (see: dates). {literal} }{ {";
    // The segment names are English: in a sentence, or as a capitalised
    // label, they are the page talking, not the renderer.
    prose.title = "The value of every city";
    prose.setAttribute("aria-label", "City");
    expect(rawSyntaxLeaks(prose)).toEqual([]);
  });

  for (const editing of [false, true]) {
    it(`in ${editing ? "Editing" : "Reading"}`, async () => {
      const { container } = render(
        <PageEditor detail={trip} context={context} user={user} value={doc} onChange={() => {}} editable={editing} />,
      );
      // Every node view has mounted and printed SOMETHING — a chip, a ghost,
      // a table or a placeholder — so "no syntax" is said about real output.
      await waitFor(() => {
        // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the witness is "every widget node view mounted"; no role or label names a node view, and a widget's output has no role in common.
        const views = container.querySelectorAll(".tc-page-editor [data-macro-name]");
        expect(views.length).toBeGreaterThanOrEqual(widgets.length);
        for (const view of views) expect(view.textContent?.trim()).not.toBe("");
        chartsDrawn();
      });
      expect(rawSyntaxLeaks(container)).toEqual([]);
    });
  }

  // The authored repeat: a sentence for each day, stop and city, each naming
  // every field its collection publishes, printed once per item — in BOTH
  // modes, because Editing reads as Reading does (PR #221 preview). A leak
  // here would be the template itself reaching the page.
  //
  // Budgeted, as it was when each line rendered every widget: measured
  // 2026-09-24 on a 4-CPU container at ~1.9s idle and 4.8-5.6s with every core
  // saturated, where Vitest's default 5s timed it out once in a 105-file run.
  // The sentence lines are cheaper than that, and the budget is left alone.
  const REPEAT_PAGE_BUDGET_MS = 15_000;
  for (const editing of [false, true]) {
    it(`on a page of repeats, in ${editing ? "Editing" : "Reading"}`, async () => {
      const { container } = render(
        <PageEditor
          detail={trip}
          context={context}
          user={user}
          globals={globals}
          value={repeatPage}
          onChange={() => {}}
          editable={editing}
        />,
      );
      await waitFor(() => {
        // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the witness is "the repeats rendered": a line per item in either mode; a line has no role.
        const drawn = container.querySelectorAll("[data-repeat-line]");
        // Witness, measured: 3 days + 6 stops + 2 cities, in either mode.
        expect(drawn.length).toBe(11);
        expect(screen.queryAllByTestId("repeat-rail")).toHaveLength(editing ? repeats.length : 0);
        chartsDrawn();
      });
      expect(rawSyntaxLeaks(container)).toEqual([]);
    }, REPEAT_PAGE_BUDGET_MS);
  }

  // A page written by a newer build, or a widget whose stored params no longer
  // parse: the two fallbacks that used to print the stored name.
  for (const editing of [false, true]) {
    it(`for a widget this build cannot render, in ${editing ? "Editing" : "Reading"}`, async () => {
      const unknown: MacroNode = { type: "macro", attrs: { name: "trip.fromTheFuture", params: {} } };
      // `stop.rows` (a stored identifier the detector knows) with an `only` it does not accept.
      const badParams: MacroNode = { type: "macro", attrs: { name: "stop.rows", params: { only: "nope" } } };
      const broken = newPageDoc(
        [unknown, badParams].map((node) => ({
          type: "paragraph" as const,
          content: [{ type: "text" as const, text: "Before " }, node, { type: "text" as const, text: " after." }],
        })),
      );
      const { container } = render(
        <PageEditor detail={trip} context={context} user={user} value={broken} onChange={() => {}} editable={editing} />,
      );
      await screen.findByText(/isn.t available in this version/);
      expect(screen.getByText(/settings no longer fit/)).toBeTruthy();
      expect(rawSyntaxLeaks(container)).toEqual([]);
      // The unknown name is not a registered identifier, so the detector cannot
      // know it: assert it directly.
      expect(container.textContent).not.toMatch(/fromTheFuture/);
    });
  }

  // ADR-038 decision 4's fallback, shown when this build cannot mount an editor
  // over a stored page. It renders without resolving anything, which is exactly
  // where printing the stored name was the easy thing to do — and it did, until
  // this test.
  it("in the read-only fallback", () => {
    const { container } = render(<ReadOnlyPageDoc doc={doc} />);
    expect(screen.getAllByText(/^Before /)).toHaveLength(widgets.length);
    expect(rawSyntaxLeaks(container)).toEqual([]);
  });

  it("in the read-only fallback, for a page of repeats", () => {
    const { container } = render(<ReadOnlyPageDoc doc={repeatPage} />);
    expect(screen.getAllByText(/^For every (day|stop|city)$/)).toHaveLength(repeats.length);
    expect(rawSyntaxLeaks(container)).toEqual([]);
  });
});
