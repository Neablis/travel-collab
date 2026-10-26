import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIndicator } from "./useIndicator";

// M54 decision 11: one indicator per tab list, placed under the active trigger
// from a measurement. jsdom lays nothing out, so each box is stubbed by test id
// and the ResizeObserver is a fake whose callback the test fires by hand.
type Box = { left: number; top: number; width: number; height: number };
let boxes: Record<string, Box>;

let observed: Element[];
let resize: (() => void) | undefined;
class FakeResizeObserver {
  constructor(callback: () => void) {
    resize = callback;
  }
  observe(node: Element) {
    observed.push(node);
  }
  disconnect() {
    observed = [];
  }
}

beforeEach(() => {
  boxes = {
    list: { left: 100, top: 50, width: 300, height: 40 },
    a: { left: 104, top: 52, width: 60, height: 36 },
    b: { left: 170, top: 52, width: 90, height: 36 },
  };
  observed = [];
  resize = undefined;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = boxes[this.dataset.testid ?? ""] ?? { left: 0, top: 0, width: 0, height: 0 };
    return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box };
  });
});

afterEach(() => {
  Reflect.deleteProperty(document, "fonts");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Strip({ active }: { active: "a" | "b" | null }) {
  const list = useRef<HTMLDivElement>(null);
  const { indicator, trigger, ready } = useIndicator(list, active);
  return (
    <div ref={list} data-testid="list" data-ready={ready}>
      <span ref={indicator} data-testid="indicator" />
      <span ref={trigger("a")} data-testid="a" />
      <span ref={trigger("b")} data-testid="b" />
    </div>
  );
}

const placed = () => {
  const style = screen.getByTestId("indicator").style;
  return {
    x: style.getPropertyValue("--indicator-x"),
    y: style.getPropertyValue("--indicator-y"),
    w: style.getPropertyValue("--indicator-w"),
    h: style.getPropertyValue("--indicator-h"),
    scale: style.getPropertyValue("--indicator-scale"),
  };
};

describe("useIndicator", () => {
  it("places the indicator on the active trigger, relative to its list", () => {
    render(<Strip active="b" />);
    expect(placed()).toEqual({ x: "70px", y: "2px", w: "90px", h: "36px", scale: "90" });
    expect(screen.getByTestId("list").dataset.ready).toBe("true");
  });

  it("moves when the active trigger changes", () => {
    const { rerender } = render(<Strip active="a" />);
    expect(placed().x).toBe("4px");
    rerender(<Strip active="b" />);
    expect(placed().x).toBe("70px");
  });

  it("hides the indicator when nothing in the list is active", () => {
    render(<Strip active={null} />);
    expect(screen.getByTestId("indicator").hidden).toBe(true);
  });

  // A resize that moves the tab without re-rendering the list (the phone tab
  // bar's tabs are `flex-1`, so a wider viewport moves every one of them).
  it("follows the trigger when the list or the trigger resizes", () => {
    render(<Strip active="b" />);
    expect(observed.map((n) => (n as HTMLElement).dataset.testid)).toEqual(["list", "b"]);
    boxes.b = { left: 230, top: 52, width: 120, height: 36 };
    act(() => resize?.());
    expect(placed()).toMatchObject({ x: "130px", w: "120px" });
  });

  // The first measurement can come before the web font has swapped in, and a
  // label set in the fallback face is a different width.
  it("measures again once the fonts are ready", async () => {
    let fontsReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      fontsReady = resolve;
    });
    // jsdom has no `document.fonts` at all.
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    render(<Strip active="b" />);
    boxes.b = { left: 172, top: 52, width: 96, height: 36 };
    await act(async () => {
      fontsReady();
      await ready;
    });
    expect(placed()).toMatchObject({ x: "72px", w: "96px" });
  });
});
