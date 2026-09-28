import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import { DaysFilter } from "./DaysFilter";

// Mitchell, PR #269 preview: *"The date picker in a widget for selecting days
// should allow Click and drag to select multiple"*. The gesture is hit-tested
// with `elementFromPoint`, which jsdom does not have — so each test points it
// at the cell the "pointer" is over, as `DayRiver.test.tsx` does.

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "elementFromPoint");
});

const DATES = ["2027-06-01", "2027-06-02", "2027-06-03", "2027-06-04"];
const detail = tripDetailFixture({
  days: DATES.map((date, i) => ({
    dayId: `${i + 1}b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d`,
    activityIds: [],
    date,
    costSubtotal: 0,
  })),
});

const mouse = { pointerType: "mouse", pointerId: 1, button: 0, buttons: 1 } as const;
const finger = { pointerType: "touch", pointerId: 7, button: 0, buttons: 1 } as const;

function Harness({
  onChange,
  initial,
}: {
  onChange: (params: Record<string, unknown>) => void;
  initial: Record<string, unknown>;
}) {
  const [params, setParams] = useState<Record<string, unknown>>(initial);
  return (
    <DaysFilter
      params={params}
      detail={detail}
      layout="stacked"
      id="days"
      label="The days: dates"
      onChange={(next) => {
        onChange(next);
        setParams(next);
      }}
    />
  );
}

// The button that opens the grid, which is also the label saying what is
// picked — the words a reader of the settings panel sees.
const trigger = () => screen.getByRole("button", { name: "The days: dates" });

async function openFilter(initial: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} initial={initial} />);
  await userEvent.click(trigger());
  const grid = await screen.findByRole("group", { name: "Trip days" });
  const cells = within(grid).getAllByRole("button");
  let under: Element | null = null;
  document.elementFromPoint = () => under;
  const over = (cell: Element) => {
    under = cell;
  };
  const pressed = () => cells.map((c) => c.getAttribute("aria-pressed") === "true");
  return { onChange, cells, over, pressed };
}

describe("DaysFilter — click and drag across days", () => {
  it.each([
    { pointer: "mouse", init: mouse },
    { pointer: "finger", init: finger },
  ])("a $pointer pressed on Day 1 and dragged to Day 3 selects Days 1–3 in one write", async ({ init }) => {
    const { onChange, cells, over, pressed } = await openFilter();

    fireEvent.pointerDown(cells[0]!, init);
    over(cells[1]!);
    fireEvent.pointerMove(window, init);
    over(cells[2]!);
    fireEvent.pointerMove(window, init);
    // The run shows while the drag lasts, and nothing is written yet.
    expect(pressed()).toEqual([true, true, true, false]);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, init);
    // The click the release produces is the drag's, not a pick of Day 3.
    fireEvent.click(cells[2]!);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ dates: { from: "2027-06-01", through: "2027-06-03" } });
    expect(pressed()).toEqual([true, true, true, false]);
  });

  it("a drag backwards from Day 4 to Day 2 stores the range in date order", async () => {
    const { onChange, cells, over } = await openFilter();

    fireEvent.pointerDown(cells[3]!, mouse);
    over(cells[1]!);
    fireEvent.pointerMove(window, mouse);
    fireEvent.pointerUp(window, mouse);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ dates: { from: "2027-06-02", through: "2027-06-04" } });
  });

  it("Escape mid-drag writes nothing and puts the stored selection back", async () => {
    const { onChange, cells, over, pressed } = await openFilter();

    fireEvent.pointerDown(cells[0]!, mouse);
    over(cells[2]!);
    fireEvent.pointerMove(window, mouse);
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    fireEvent.pointerUp(window, mouse);

    expect(onChange).not.toHaveBeenCalled();
    expect(pressed()).toEqual([false, false, false, false]);
  });

  it("a drag replaces separate days with the run it crossed", async () => {
    const { onChange, cells, over, pressed } = await openFilter({ dates: ["2027-06-01", "2027-06-04"] });
    expect(pressed()).toEqual([true, false, false, true]);

    fireEvent.pointerDown(cells[1]!, mouse);
    over(cells[2]!);
    fireEvent.pointerMove(window, mouse);
    // The preview is the run alone: the two days already picked are not in it.
    expect(pressed()).toEqual([false, true, true, false]);
    fireEvent.pointerUp(window, mouse);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ dates: { from: "2027-06-02", through: "2027-06-03" } });
    expect(pressed()).toEqual([false, true, true, false]);
  });
});

// What a real click is: down, up and click on the same cell.
function click(cell: Element) {
  fireEvent.pointerDown(cell, mouse);
  fireEvent.pointerUp(window, mouse);
  fireEvent.click(cell);
}

// Mitchell, PR #269 preview: *"get rid of the 'First click start, second click
// end, select all elements between' this should be either drag and select, or
// click one offs"*. With `dates` holding one range a click could only REPLACE
// the selection; asked whether it should become a list so Day 2 and Day 5 could
// be picked together, he answered *"Yes go ahead"*.
describe("DaysFilter — a click picks one day at a time", () => {
  it("a click adds a day to what is picked, so Day 2 and Day 4 are stored together", async () => {
    const { onChange, cells, pressed } = await openFilter();

    click(cells[1]!);
    click(cells[3]!);

    expect(onChange.mock.calls).toEqual([
      // One day is still the range it always was — nothing about a single
      // pick moved when the list arrived.
      [{ dates: { from: "2027-06-02", through: "2027-06-02" } }],
      // Two days with a day between them: a list, which a range cannot hold.
      [{ dates: ["2027-06-02", "2027-06-04"] }],
    ]);
    expect(pressed()).toEqual([false, true, false, true]);
    // Said as the page says dates, not as `2027-06-02`.
    expect(trigger().textContent).toBe("Jun 2, Jun 4");
    expect(screen.queryByText(/Now pick the last day/)).toBeNull();
  });

  it("days picked next to each other are stored as a range, not a list", async () => {
    const { onChange, cells } = await openFilter();

    click(cells[2]!);
    click(cells[0]!);
    click(cells[1]!);

    expect(onChange).toHaveBeenLastCalledWith({ dates: { from: "2027-06-01", through: "2027-06-03" } });
    expect(trigger().textContent).toBe("Jun 1 – Jun 3");
  });

  it("a click on a picked day takes it away, and taking the last one away is All days", async () => {
    const { onChange, cells, pressed } = await openFilter({ dates: ["2027-06-02", "2027-06-04"] });

    click(cells[3]!);
    expect(onChange).toHaveBeenLastCalledWith({ dates: { from: "2027-06-02", through: "2027-06-02" } });
    click(cells[1]!);

    // Nothing stored: "every day" is the absent key, never an empty filter.
    expect(onChange).toHaveBeenLastCalledWith({});
    expect(pressed()).toEqual([false, false, false, false]);
    expect(trigger().textContent).toBe("All days");
  });

  it("a migrated `day` binding is one of the picked days, and a click adds to it", async () => {
    // Documents from before ADR-039's v1 → v2 step carry `day`; the control
    // still reads it, and must not drop it on the first click.
    const { onChange, cells, pressed } = await openFilter({ day: { kind: "index", index: 1 } });
    expect(pressed()).toEqual([false, true, false, false]);

    click(cells[3]!);

    expect(onChange).toHaveBeenLastCalledWith({ dates: ["2027-06-02", "2027-06-04"] });
  });

  // A drag needs a pointer, so the keyboard reaches a run with Shift — the
  // convention lists and calendars already use.
  it("the keyboard selects a run with Shift: Enter on the first day, Shift+Space on the last", async () => {
    const { onChange, cells, pressed } = await openFilter();

    cells[0]!.focus();
    await userEvent.keyboard("{Enter}");
    cells[2]!.focus();
    await userEvent.keyboard("{Shift>} {/Shift}");

    expect(onChange).toHaveBeenLastCalledWith({ dates: { from: "2027-06-01", through: "2027-06-03" } });
    expect(pressed()).toEqual([true, true, true, false]);
  });

  it("Shift ADDS its run to the days already picked rather than replacing them", async () => {
    const { onChange, cells, pressed } = await openFilter();

    cells[3]!.focus();
    await userEvent.keyboard("{Enter}");
    cells[0]!.focus();
    await userEvent.keyboard("{Enter}");
    cells[1]!.focus();
    await userEvent.keyboard("{Shift>} {/Shift}");

    // Day 4 was picked first and is still there: the run Day 1–2 joined it.
    expect(onChange).toHaveBeenLastCalledWith({ dates: ["2027-06-01", "2027-06-02", "2027-06-04"] });
    expect(pressed()).toEqual([true, true, false, true]);
    expect(trigger().textContent).toBe("Jun 1, Jun 2, Jun 4");
  });
});
