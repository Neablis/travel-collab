import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scenarios } from "@tc/factories";
import { MACRO_NAMES, PRESETS } from "@tc/pages";
import {
  RAW_SYNTAX,
  STORED_IDENTIFIERS,
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
// **Not covered yet, deliberately, because it fails today:** a stored widget
// this build does not know, or whose params no longer parse. `MacroView`
// prints `unknown macro: <name>` / `bad params: <name>` for those. That is
// raw syntax on the screen, recorded against the gate box in
// `docs/milestones/M14-rich-layer.md`. The case belongs here once MacroView
// says something a person can read.

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

describe("no macro syntax reaches the DOM", () => {
  // The witnesses: the guard is only worth anything if the page it scans
  // really holds every widget, and if every pattern can match.
  it("covers every preset and every registered widget, and each pattern can fire", () => {
    expect(widgets.length).toBe(PRESETS.length + MACRO_NAMES.length);
    expect(STORED_IDENTIFIERS).toEqual(expect.arrayContaining(["cost.rows", "day.detail", "trip.countdown"]));

    // Every category fires on a sample of itself, on text and on an attribute.
    const probe = document.createElement("p");
    probe.textContent = 'day.detail {{cost}} [[Kyoto]] @cost(day=1) {"dates":{}} [object Object]';
    probe.title = "unknown macro: stop.rows";
    const categories = new Set(rawSyntaxLeaks(probe).map((l) => l.split(" — ")[0]));
    expect([...categories].sort()).toEqual(
      [
        "stored identifier day.detail",
        "stored identifier stop.rows",
        ...RAW_SYNTAX.filter(([what]) => !what.startsWith("stored identifier")).map(([what]) => what),
      ].sort(),
    );
    // …and none fires on prose a page legitimately holds, or the guard would be
    // tuned down the first time it cried wolf.
    const prose = document.createElement("p");
    prose.textContent = "Day 1 · 2027-06-01 — Kyoto, $1,200.00 of the cost; 3 stops, 2 booked (see: dates).";
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
      });
      expect(rawSyntaxLeaks(container)).toEqual([]);
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
});
