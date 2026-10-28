import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FitRow, fitCount } from "./fit-row";

describe("fitCount", () => {
  it("draws every item, and no chip, when they all fit", () => {
    expect(fitCount({ widths: [40, 40, 40], more: 30, gap: 6, room: 132 })).toBe(3);
  });

  // Two items and the chip: 40 + 6 + 40 + 6 + 30 = 122. A third would leave
  // the chip no room, though the three alone (132) would just about fit.
  it("keeps room for the chip when an item has to fold into it", () => {
    expect(fitCount({ widths: [40, 40, 40, 40], more: 30, gap: 6, room: 131 })).toBe(2);
    expect(fitCount({ widths: [40, 40, 40, 40], more: 30, gap: 6, room: 121 })).toBe(1);
  });

  it("never draws fewer than one item, which truncates instead", () => {
    expect(fitCount({ widths: [300, 40], more: 30, gap: 6, room: 100 })).toBe(1);
    expect(fitCount({ widths: [], more: 30, gap: 6, room: 100 })).toBe(0);
  });

  // A matched city is drawn whatever the room, and the last of them truncates.
  it("draws at least `min`, whatever the room", () => {
    expect(fitCount({ widths: [80, 80, 80, 40], more: 30, gap: 6, room: 100, min: 2 })).toBe(2);
    expect(fitCount({ widths: [80, 80], more: 30, gap: 6, room: 100, min: 5 })).toBe(2);
  });

  it("draws no more than `max`, whatever the room", () => {
    expect(fitCount({ widths: [10, 10, 10, 10, 10], more: 10, gap: 0, room: 1000, max: 3 })).toBe(3);
  });
});

describe("FitRow", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // jsdom lays nothing out, so the widths are the test's: a row of `room`
  // pixels, items 40px each, a 6px gap, and the "+N" chip 20px.
  let room = 100;
  function laidOut() {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "row" ? room : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: this.dataset.fitMore !== undefined ? 20 : 40 } as DOMRect;
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ columnGap: "6px" } as CSSStyleDeclaration);
  }

  const row = (names: string[]) => (
    <FitRow
      data-testid="row"
      items={names.map((x) => (
        <span key={x}>{x}</span>
      ))}
      more={(hidden) => <span>+{hidden}</span>}
    />
  );

  it("draws the items that fit on one line and counts the rest", () => {
    // 40 + 6 + 40 + 6 + 20 = 112 fits 120; a third item would need 158.
    room = 120;
    laidOut();
    render(row(["a", "b", "c", "d"]));
    expect(screen.getByTestId("row").textContent).toBe("ab+2");
  });

  // As many items in another order is another row: the count is measured
  // for these items, not reused from the last ones (part-reviewer, PR 628).
  it("measures again for new items, even as many of them", () => {
    room = 120;
    laidOut();
    const { rerender } = render(row(["a", "b", "c", "d"]));
    expect(screen.getByTestId("row").textContent).toBe("ab+2");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: this.dataset.fitMore !== undefined ? 20 : 25 } as DOMRect;
    });
    rerender(row(["d", "c", "b", "a"]));
    // Four of 25px and three gaps are 118, which fits 120: every item, and
    // no chip. The count measured for the last items would say "dc+2".
    expect(screen.getByTestId("row").textContent).toBe("dcba");
  });
});
