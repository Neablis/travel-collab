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

function Harness({ onChange }: { onChange: (params: Record<string, unknown>) => void }) {
  const [params, setParams] = useState<Record<string, unknown>>({});
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

async function openFilter() {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: "The days: dates" }));
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

  // Mitchell, PR #269 preview: *"get rid of the 'First click start, second
  // click end, select all elements between' this should be either drag and
  // select, or click one offs"*.
  it("a click is that one day, a second click moves to the day clicked, and clicking it again clears", async () => {
    const { onChange, cells, pressed } = await openFilter();

    // What a real click is: down, up and click on the same cell.
    const click = (cell: Element) => {
      fireEvent.pointerDown(cell, mouse);
      fireEvent.pointerUp(window, mouse);
      fireEvent.click(cell);
    };
    click(cells[1]!);
    click(cells[3]!);
    expect(pressed()).toEqual([false, false, false, true]);
    click(cells[3]!);

    expect(onChange.mock.calls).toEqual([
      [{ dates: { from: "2027-06-02", through: "2027-06-02" } }],
      [{ dates: { from: "2027-06-04", through: "2027-06-04" } }],
      [{}],
    ]);
    expect(pressed()).toEqual([false, false, false, false]);
    expect(screen.queryByText(/Now pick the last day/)).toBeNull();
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
});
