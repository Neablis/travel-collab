import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sparkline, sparklineBars } from "./Sparkline";

afterEach(cleanup);

describe("sparklineBars", () => {
  it("emits one column per day with a bar per stop", () => {
    const bars = sparklineBars([{ stops: 2 }, { stops: 0 }, { stops: 4 }]);
    expect(bars.map((c) => c.length)).toEqual([2, 0, 4]);
  });
});

describe("Sparkline", () => {
  it("renders one clickable column per day", () => {
    render(<Sparkline days={[{ stops: 1 }, { stops: 3 }]} onSelectDay={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
