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

  it("draws no more than `max`, whatever the room", () => {
    expect(fitCount({ widths: [10, 10, 10, 10, 10], more: 10, gap: 0, room: 1000, max: 3 })).toBe(3);
  });
});

describe("FitRow", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // jsdom lays nothing out, so the widths are the test's: a 100px row, items
  // 40px each, a 6px gap, and the "+N" chip 20px.
  function laidOut() {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "row" ? 100 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.fitMore !== undefined ? 20 : 40;
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ columnGap: "6px" } as CSSStyleDeclaration);
  }

  it("draws the items that fit on one line and counts the rest", () => {
    laidOut();
    render(
      <FitRow
        data-testid="row"
        items={["a", "b", "c", "d"].map((x) => (
          <span key={x}>{x}</span>
        ))}
        more={(hidden) => <span data-testid="more">+{hidden}</span>}
      />,
    );
    // 40 + 6 + 40 + 6 + 20 = 112 > 100, so one item and "+3".
    expect(screen.getByTestId("row").textContent).toBe("a+3");
  });
});
