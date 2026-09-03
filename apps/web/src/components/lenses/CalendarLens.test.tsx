import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import { FocusProvider, useFocus } from "../trip/context/FocusProvider";
import { CalendarLens } from "./CalendarLens";

afterEach(cleanup);

const day1 = "11111111-1111-4111-8111-111111111111";
const rome = "22222222-2222-4222-8222-222222222222";
const forum = "33333333-3333-4333-8333-333333333333";
const flight = "44444444-4444-4444-8444-444444444444";

const JUNE_GRID_LABEL = "Trip calendar, June 2027";

// Reads focusedDay back out of the same FocusProvider CalendarLens is
// wrapped in — the provider itself has no visible output, so a click's
// effect on setFocusedDay is otherwise unobservable (mirrors
// FocusProvider.test.tsx's Probe pattern).
function FocusProbe() {
  const { focusedDay } = useFocus();
  return <span data-testid="focused-day">{String(focusedDay)}</span>;
}

function renderLens(detail: ReturnType<typeof tripDetailFixture>) {
  return render(
    <FocusProvider>
      <CalendarLens detail={detail} />
      <FocusProbe />
    </FocusProvider>,
  );
}

/**
 * The same render plus a control that sets tag focus, since no chip is
 * reachable from this lens — the Calendar renders city cards, not stops, so
 * the only way in from here is the focus state itself.
 */
function TagFocusControl({ tag }: { tag: "meal" | "lodging" }) {
  const { toggleFocusedTag } = useFocus();
  return <button onClick={() => toggleFocusedTag(tag)}>focus {tag}</button>;
}

function renderLensWithTagControl(detail: ReturnType<typeof tripDetailFixture>, tag: "meal" | "lodging" = "meal") {
  return render(
    <FocusProvider>
      <TagFocusControl tag={tag} />
      <CalendarLens detail={detail} />
      <FocusProbe />
    </FocusProvider>,
  );
}

// A trip whose days hold no stops at all. `calendarMonths` pads the grid out
// to whole weeks, so this fixture also supplies the out-of-trip cells the
// empty-day copy must NOT reach.
function detailWithEmptyDay(dayCount = 1) {
  return tripDetailFixture({
    startDate: "2027-06-01",
    days: Array.from({ length: dayCount }, (_, i) => ({
      dayId: `${i}0000000-0000-4000-8000-000000000000`,
      activityIds: [],
      date: `2027-06-0${i + 1}`,
      costSubtotal: 0,
    })),
    activities: {},
  });
}

function detailFixture() {
  return tripDetailFixture({
    startDate: "2027-06-01",
    days: [{ dayId: day1, activityIds: [rome, forum, flight], date: "2027-06-01", costSubtotal: 0 }],
    activities: {
      [rome]: {
        activityId: rome,
        title: "Colosseum tour",
        timeWindow: { start: "09:00", end: "11:00" },
        location: { name: "Rome", city: "Rome" },
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
      [forum]: {
        activityId: forum,
        title: "Roman Forum",
        timeWindow: { start: "11:30", end: "13:00" },
        location: { name: "Rome", city: "Rome" },
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
      [flight]: {
        activityId: flight,
        title: "Flight home",
        timeWindow: { start: "17:00", end: "17:30" },
        location: null,
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
    },
  });
}

describe("CalendarLens", () => {
  it("renders the 7-column weekday header, Sunday first", () => {
    renderLens(detailFixture());
    const grid = screen.getByRole("grid", { name: JUNE_GRID_LABEL });
    // The header is the grid's first 7 children, in order — asserting each
    // label merely exists would also pass for a Monday-first grid.
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const headerLabels = Array.from(grid.children)
      .slice(0, 7)
      .map((el) => el.textContent);
    expect(headerLabels).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });

  it("renders the month header and the days-held note", () => {
    renderLens(detailFixture());
    expect(screen.getByText("June 2027")).toBeDefined();
    // "Day 1" appears twice: the note beside the month header, and the cell's
    // own "Day N" label — both are asserted elsewhere, so just confirm the
    // note's copy exists at all.
    expect(screen.getAllByText("Day 1").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the empty state and no grid when the trip has no start date", () => {
    renderLens(tripDetailFixture());
    expect(screen.getByText("Set a start date to see the calendar.")).toBeDefined();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  // dc.html:3053's per-day summary line sits BELOW up to three stop chips
  // (dc.html:663-696) — it does not replace them (that was 8b.5's gap).
  it("shows Day N, city, and the stop-count/time-range summary on an in-trip cell", () => {
    renderLens(detailFixture());
    const cell = screen.getByRole("button", { name: /^Day 1,/ });
    expect(cell.textContent).toContain("Day 1");
    expect(cell.textContent).toContain("Rome");
    // TWO cards, not one: Rome's two stops, and the unlocated flight home in
    // its own untitled bucket (Mitchell, 2026-08-29 — "1 card with no city in
    // its header"). This has moved twice. It asserted "2 stops" while a
    // city-less stop opened a nameless group that rendered as a strip; then
    // "3 stops" while such stops folded into the day's last city; now the
    // bucket is a real card, so each carries its own count and window.
    expect(cell.textContent).toContain("2 stops");
    expect(cell.textContent).toContain("1 stop");
    // Rome's own extent, 09:00–13:00 — no longer stretched to 17:30 by a stop
    // that was never in Rome.
    expect(cell.textContent).toContain("9 am – 1 pm");
    expect(cell.textContent).toContain("5 pm – 5:30 pm");
  });

  // SPEC §12 replaced the per-stop chips with a per-city summary: "Calendar no
  // longer lists activities." These two tests used to assert the chips existed
  // and that a fourth stop was elided; both now assert the opposite, because
  // naming individual stops here is the thing the redesign removed.
  it("names no individual stop — the cell summarises, it does not list", () => {
    renderLens(detailFixture());
    const cell = screen.getByRole("button", { name: /^Day 1,/ });

    expect(within(cell).queryAllByTestId("calendar-chip")).toHaveLength(0);
    expect(cell.textContent).not.toContain("Colosseum tour");
    expect(cell.textContent).not.toContain("Roman Forum");
    expect(cell.textContent).not.toContain("Flight home");
    // What replaces them: the city, each group's stop count, and its window.
    expect(cell.textContent).toContain("Rome");
    expect(cell.textContent).toContain("2 stops");
  });

  it("counts every stop in the summary, however many there are", () => {
    // The old cell showed three chips and silently dropped the rest; a count
    // has no such ceiling, which is half the point of the change.
    const ids = Array.from({ length: 9 }, (_, i) => `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`);
    renderLens(
      tripDetailFixture({
        startDate: "2027-06-01",
        days: [{ dayId: day1, activityIds: ids, date: "2027-06-01", costSubtotal: 0 }],
        activities: Object.fromEntries(
          ids.map((id, i) => [
            id,
            { activityId: id, title: `Stop ${i + 1}`, timeWindow: null, location: { name: "Rome", city: "Rome" }, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
          ]),
        ),
      }),
    );
    const cell = screen.getByRole("button", { name: /^Day 1,/ });

    expect(cell.textContent).toContain("9 stops");
    expect(cell.textContent).not.toContain("Stop 1");
    expect(cell.textContent).not.toContain("Nothing planned yet");
  });

  // A shorter window nested entirely inside a longer one sorts *after* it by
  // start (10:00 > 09:00), so "take the last-sorted end" would report 11 am
  // and hide that the day actually runs to 5 pm.
  it("reports the enclosing window's end, not a shorter window nested inside it", () => {
    const detail = tripDetailFixture({
      startDate: "2027-06-01",
      days: [{ dayId: day1, activityIds: [rome, forum], date: "2027-06-01", costSubtotal: 0 }],
      activities: {
        [rome]: {
          activityId: rome,
          title: "All-day pass",
          timeWindow: { start: "09:00", end: "17:00" },
          location: { name: "Rome", city: "Rome" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
        [forum]: {
          activityId: forum,
          title: "Guided tour",
          timeWindow: { start: "10:00", end: "11:00" },
          location: { name: "Rome", city: "Rome" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
      },
    });
    renderLens(detail);
    const cell = screen.getByRole("button", { name: /^Day 1,/ });
    expect(cell.textContent).toContain("9 am – 5 pm");
    expect(cell.textContent).not.toContain("11 am");
  });

  it("omits the time range when none of the day's stops are timed", () => {
    const detail = tripDetailFixture({
      startDate: "2027-06-01",
      days: [{ dayId: day1, activityIds: [rome], date: "2027-06-01", costSubtotal: 0 }],
      activities: {
        [rome]: {
          activityId: rome,
          title: "Colosseum tour",
          timeWindow: null,
          location: { name: "Rome", city: "Rome" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
      },
    });
    renderLens(detail);
    const cell = screen.getByRole("button", { name: /^Day 1,/ });
    expect(cell.textContent).toContain("1 stop");
    expect(cell.textContent).not.toContain("1 stops");
    expect(cell.textContent).not.toContain("·");
  });

  it("clicking an in-trip cell calls setFocusedDay with the 0-based day index", async () => {
    renderLens(detailFixture());
    await userEvent.click(screen.getByRole("button", { name: /^Day 1,/ }));
    // cell.ordinal is 1 (1-based) → setFocusedDay(0).
    expect(screen.getByTestId("focused-day").textContent).toBe("0");
  });

  // The phase file's own Step 1 test for this lens, verbatim.
  it("says nothing is planned on an in-trip day with no stops", () => {
    renderLens(detailWithEmptyDay());
    expect(screen.getByText("Nothing planned yet")).toBeTruthy();
  });

  // The copy belongs to in-trip days only. Out-of-trip cells are the grid's
  // week padding — dimmed date numbers — and must not claim a plan is missing
  // from a day the trip never covered.
  it("leaves out-of-trip cells without the empty-day copy", () => {
    renderLens(detailWithEmptyDay());
    const outOfTrip = screen
      .getAllByTestId("calendar-cell")
      .filter((cell) => cell.getAttribute("data-in-trip") === "false");
    expect(outOfTrip.length).toBeGreaterThan(0);
    for (const cell of outOfTrip) {
      expect(cell.textContent).not.toContain("Nothing planned yet");
    }
    // Exactly one in-trip day, so exactly one instance of the copy.
    expect(screen.getAllByText("Nothing planned yet")).toHaveLength(1);
  });

  it("says it on every day of an all-empty trip", () => {
    renderLens(detailWithEmptyDay(3));
    expect(screen.getAllByText("Nothing planned yet")).toHaveLength(3);
  });

  it("does not say it on a day that has stops", () => {
    renderLens(detailFixture());
    expect(screen.queryByText("Nothing planned yet")).toBeNull();
  });

  // A trip with no days at all has no start date in this fixture family, so
  // the lens falls back to its existing "Set a start date" state rather than
  // rendering a grid of empty-day copy.
  it("renders no grid, and no empty-day copy, for a trip with no days", () => {
    renderLens(tripDetailFixture({ days: [], activities: {} }));
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.queryByText("Nothing planned yet")).toBeNull();
  });

  // A dated trip whose day list is empty falls back to the same "Set a start
  // date" state as an undated trip — there is no month to derive a block
  // from, so nothing is rendered rather than an all-padding grid.
  it("renders the empty state, not a grid, for a dated trip with no days", () => {
    renderLens(tripDetailFixture({ startDate: "2027-06-01", days: [], activities: {} }));
    expect(screen.getByText("Set a start date to see the calendar.")).toBeDefined();
    expect(screen.queryAllByTestId("calendar-cell")).toHaveLength(0);
    expect(screen.queryByText("Nothing planned yet")).toBeNull();
  });

  it("puts the day tint on the inner card, not the cell button", () => {
    renderLens(detailFixture());
    const button = screen.getByRole("button", { name: /^Day 1,/ });
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(button.className).toMatch(/bg-surface/);
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(button.className).not.toMatch(/-tint\b/);
    // Several cards per cell now (one per city, plus the untitled bucket), so
    // every one of them must carry the tint, not merely the first.
    const cards = within(button).getAllByTestId("calendar-day-card");
    expect(cards.length).toBeGreaterThan(1);
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    for (const card of cards) expect(card.className).toMatch(/bg-\w+-tint/);
  });

  // dc.html:663-696: the city name lives in the tinted card's header row,
  // beside the grip — not loose text in the cell.
  //
  // CodeRabbit (PR #46 final review): the cell's `aria-label` already bakes
  // in "Day 1, Rome" regardless of what actually renders, and the old
  // `card.textContent` check searched the whole card, so this couldn't fail
  // even if the header row were deleted (aria-label unaffected) or "Rome"
  // only survived somewhere else in the card. Scoped to the header element
  // itself, found by test id rather than by the accessible name that isn't
  // wired to the visible markup either.
  it("shows the city in the day card header", () => {
    renderLens(detailFixture());
    const cell = screen.getByRole("button", { name: /^Day 1,/ });
    const [romeCard, bucketCard] = within(cell).getAllByTestId("calendar-day-card");
    expect(within(romeCard!).getByTestId("calendar-day-header").textContent).toContain("Rome");
    // The untitled bucket's header carries the grip and NO city text — an
    // invented label ("Unknown", "No place") would be the same lie as falling
    // back to a venue name, which KI-35 forbade.
    expect(within(bucketCard!).getByTestId("calendar-day-header").textContent).toBe("");
  });

  // dc.html:668-670: "Day N" sits on the cell's top row, right of the date
  // number, only when `c.inTrip`.
  //
  // CodeRabbit (PR #46 final review): `getByRole("button", { name: /Day 1/ })`
  // matches the button's `aria-label`, which is set unconditionally and
  // independently of whatever actually renders inside it — this assertion
  // could never fail even if the visible "Day N" span were deleted entirely.
  // Query the visible label element itself instead.
  it("renders the Day N label for in-trip days only, never for out-of-trip days", () => {
    renderLens(detailWithEmptyDay());
    const day1Cell = screen.getByRole("button", { name: /^Day 1,/ });
    expect(within(day1Cell).getByTestId("calendar-day-label").textContent).toBe("Day 1");
    const outOfTrip = screen
      .getAllByTestId("calendar-cell")
      .filter((cell) => cell.getAttribute("data-in-trip") === "false");
    expect(outOfTrip.length).toBeGreaterThan(0);
    for (const cell of outOfTrip) {
      expect(within(cell).queryByTestId("calendar-day-label")).toBeNull();
    }
  });

  // dc.html:678's `sc-if value="c.inTrip"` — an out-of-trip cell renders no
  // inner card at all (no tint, no grip, no chips), just the bare date.
  it("renders no inner card on an out-of-trip cell", () => {
    renderLens(detailWithEmptyDay());
    const outOfTrip = screen
      .getAllByTestId("calendar-cell")
      .filter((cell) => cell.getAttribute("data-in-trip") === "false");
    expect(outOfTrip.length).toBeGreaterThan(0);
    for (const cell of outOfTrip) {
      expect(within(cell).queryByTestId("calendar-day-card")).toBeNull();
    }
  });

  // A trip that crosses a month boundary renders one grid per month, each
  // with its own header — the component-level counterpart to
  // calendarData.test.ts's pure `calendarMonths` coverage.
  it("renders one grid per month for a trip crossing a month boundary", () => {
    const days = Array.from({ length: 10 }, (_, i) => {
      const dt = new Date(Date.UTC(2022, 10, 27 + i));
      return {
        dayId: `88888888-8888-4888-8888-${String(i).padStart(12, "0")}`,
        activityIds: [],
        date: dt.toISOString().slice(0, 10),
        costSubtotal: 0,
      };
    });
    renderLens(tripDetailFixture({ startDate: "2022-11-27", days, activities: {} }));
    expect(screen.getByRole("grid", { name: "Trip calendar, November 2022" })).toBeDefined();
    expect(screen.getByRole("grid", { name: "Trip calendar, December 2022" })).toBeDefined();
    expect(screen.getByText("November 2022")).toBeDefined();
    expect(screen.getByText("December 2022")).toBeDefined();
  });

  // M18. The travel-day split that briefly lived here is GONE (Mitchell,
  // 2026-08-29): the Calendar is the zoomed-out "what cities are on what days"
  // view and does not concern itself with how you got around, which is what
  // `transit` is about. `N to book` is the only thing here that reads `kind`.
  describe("stop kind (M18)", () => {
    function travelDayDetail() {
      const activity = (
        id: string,
        title: string,
        city: string | null,
        window: { start: string; end: string },
        kind: "planned" | "booked" | "hold" | "idea" | "transit",
        costMinor: number | null = null,
      ) => ({
        activityId: id,
        title,
        timeWindow: window,
        location: city === null ? null : { name: city, city },
        notes: null,
        anchors: [],
        kind,
        tags: [],
        cost: costMinor === null ? null : { amountMinor: costMinor, currency: "USD" },
      });

      return tripDetailFixture({
        startDate: "2027-06-01",
        days: [{ dayId: day1, activityIds: [rome, forum, flight], date: "2027-06-01", costSubtotal: 0 }],
        activities: {
          [rome]: activity(rome, "Dinner", "Rome", { start: "07:00", end: "07:40" }, "hold"),
          [forum]: activity(forum, "Train to Florence", "Florence", { start: "08:20", end: "10:35" }, "transit"),
          // Priced so the accessible name's money segment is enforced, not merely claimed.
          [flight]: activity(flight, "Uffizi", "Florence", { start: "14:00", end: "16:00" }, "idea", 2500),
        },
      });
    }

    it("groups a travel day by city alone, with no transit split and no strip", () => {
      renderLens(travelDayDetail());
      const cards = screen.getAllByTestId("calendar-day-card");
      // Two cities, two equal cards — and no strips at all any more.
      expect(cards).toHaveLength(2);
      expect(within(cards[0]!).getByTestId("calendar-day-header").textContent).toContain("Rome");
      expect(within(cards[1]!).getByTestId("calendar-day-header").textContent).toContain("Florence");
      expect(screen.queryAllByTestId("calendar-city-strip")).toHaveLength(0);
    });

    it("counts what needs booking per city card, excluding transit", () => {
      renderLens(travelDayDetail());
      const flags = screen.getAllByTestId("calendar-to-book");
      // Rome: the dinner on hold. Florence: the Uffizi (idea). The train is
      // transit and is excluded. See lib/needsBooking.ts — a plain `planned`
      // stop would count for neither.
      expect(flags.map((f) => f.textContent)).toEqual(["1 to book", "1 to book"]);
    });

    it("renders no flag at all on a card where nothing needs booking", () => {
      const detail = travelDayDetail();
      detail.activities[rome]!.kind = "booked";
      renderLens(detail);
      // Rome is settled, so only Florence's card carries a flag.
      expect(screen.getAllByTestId("calendar-to-book").map((f) => f.textContent)).toEqual(["1 to book"]);
    });

    // aria-label on a button REPLACES its content for assistive technology, so
    // everything these cards render has to be in the label or it is announced as
    // nothing at all. Found by CodeRabbit on PR #89, after M18 gave a cell
    // several cards and a flag where it previously had one city and no numbers.
    it("puts every card's content into the cell's accessible name", () => {
      renderLens(travelDayDetail());
      const label = screen.getByRole("button", { name: /^Day 1,/ }).getAttribute("aria-label");
      // The WHOLE name, not a sample of it. Asserting fragments let a
      // regression drop the date, either window or the cost and still pass —
      // which is the "comment claims an invariant no test enforces" class this
      // repo tracks as KI-1 / KI-14. Every segment `cellLabel` can emit appears
      // here: the ordinal, the formatted date, both cities, both stop counts,
      // a cost, both time windows, and the to-book flag.
      expect(label).toBe(
        "Day 1, Tue, Jun 1. " +
          "Rome, 1 stop, 7 am to 7:40 am, 1 to book. " +
          "Florence, 2 stops, $25.00, 8:20 am to 4 pm, 1 to book",
      );
    });

    it("names the unplaced bucket in the accessible name rather than omitting it", () => {
      renderLens(detailFixture());
      const label = screen.getByRole("button", { name: /^Day 1,/ }).getAttribute("aria-label") ?? "";
      expect(label).toContain("Rome");
      // The bucket has no city, so it needs words rather than a blank.
      expect(label).toContain("No place set");
    });

    it("says a day is empty rather than announcing only its number", () => {
      renderLens(detailWithEmptyDay());
      const label = screen.getByRole("button", { name: /^Day 1,/ }).getAttribute("aria-label") ?? "";
      expect(label).toContain("Nothing planned yet");
    });

    it("gives an unplaced stop its own card with no city in the header", () => {
      renderLens(detailFixture());
      const cards = screen.getAllByTestId("calendar-day-card");
      expect(cards).toHaveLength(2);
      expect(within(cards[1]!).getByTestId("calendar-day-header").textContent).toBe("");
      expect(cards[1]!.textContent).toContain("1 stop");
    });
  });
});

// M18b — SPEC §12's Calendar rule, which is deliberately a different rule from
// the other three lenses': a count per card, and a dim on the card that
// matches nothing. The Calendar stopped rendering individual stops at M18, so
// there is nothing here to dim per stop even if the rule wanted it.
describe("CalendarLens tag focus", () => {
  function taggedDetail() {
    const detail = detailFixture();
    detail.activities[rome]!.tags = ["meal"];
    // `forum` (Rome) and `flight` (the untitled bucket) stay untagged.
    return detail;
  }

  it("shows no match line at all until a tag is focused", () => {
    renderLens(taggedDetail());
    expect(screen.queryByTestId("calendar-tag-match")).toBeNull();
  });

  it("reports N of M match on each card once a tag is focused", async () => {
    renderLensWithTagControl(taggedDetail());
    await userEvent.click(screen.getByRole("button", { name: "focus meal" }));

    const matches = screen.getAllByTestId("calendar-tag-match").map((el) => el.textContent);
    // Rome holds `rome` (tagged) and `forum` (not); the untitled bucket holds
    // `flight` alone, which is untagged.
    expect(matches).toEqual(["1 of 2 match", "0 of 1 match"]);
  });

  it("dims the card that matches nothing, and only that card", async () => {
    renderLensWithTagControl(taggedDetail());
    await userEvent.click(screen.getByRole("button", { name: "focus meal" }));

    const cards = screen.getAllByTestId("calendar-day-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.getAttribute("data-off-tag")).toBeNull();
    expect(cards[0]!.style.opacity).toBe("1");
    expect(cards[1]!.getAttribute("data-off-tag")).toBe("true");
    expect(Number(cards[1]!.style.opacity)).toBeCloseTo(0.28);
  });

  // Dim, never hide: a dimmed card keeps every card there was, in place, with
  // its stop count and its window intact.
  it("drops no card and no line from a dimmed card", async () => {
    renderLensWithTagControl(taggedDetail());
    const before = screen.getAllByTestId("calendar-day-card").map((c) => c.textContent);
    await userEvent.click(screen.getByRole("button", { name: "focus meal" }));
    const after = screen.getAllByTestId("calendar-day-card");

    expect(after).toHaveLength(before.length);
    // Everything the card said before is still in it; the match line is added.
    for (const [i, card] of after.entries()) expect(card.textContent).toContain(before[i]!);
  });

  it("counts zero across the board for a tag no stop carries", async () => {
    renderLensWithTagControl(taggedDetail(), "lodging");
    await userEvent.click(screen.getByRole("button", { name: "focus lodging" }));

    expect(screen.getAllByTestId("calendar-tag-match").map((el) => el.textContent)).toEqual([
      "0 of 2 match",
      "0 of 1 match",
    ]);
    for (const card of screen.getAllByTestId("calendar-day-card")) {
      expect(card.getAttribute("data-off-tag")).toBe("true");
    }
  });

  // The cell IS a button, so `aria-label` replaces its content — a count only
  // rendered visually would be announced as nothing at all (the same trap
  // CodeRabbit found on PR #89 for the rest of the card's lines).
  it("puts the count in the cell's accessible name", async () => {
    renderLensWithTagControl(taggedDetail());
    await userEvent.click(screen.getByRole("button", { name: "focus meal" }));

    const cell = screen.getAllByTestId("calendar-cell").find((c) => c.getAttribute("data-in-trip") === "true");
    expect(cell!.getAttribute("aria-label")).toContain("1 of 2 match");
    expect(cell!.getAttribute("aria-label")).toContain("0 of 1 match");
  });

  // Two focuses, one page: picking a day must not clear a tag, and a tag must
  // not clear a day. The exit gate's fifth box, at this lens.
  it("keeps the day ring while a tag is focused", async () => {
    renderLensWithTagControl(taggedDetail());
    await userEvent.click(screen.getByRole("button", { name: "focus meal" }));
    const cell = screen.getAllByTestId("calendar-cell").find((c) => c.getAttribute("data-in-trip") === "true");
    await userEvent.click(cell!);

    expect(screen.getByTestId("focused-day").textContent).toBe("0");
    expect(screen.getAllByTestId("calendar-tag-match").length).toBeGreaterThan(0);
  });
});
