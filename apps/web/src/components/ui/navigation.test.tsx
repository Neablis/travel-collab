import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";
import { TabStrip } from "./tab-strip";

const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }];

describe("navigation controls (non-Radix, fireEvent-driven)", () => {
  it("TabStrip renders role=tab buttons and fires onValueChange on click", () => {
    const onValueChange = vi.fn();
    render(<TabStrip value="a" onValueChange={onValueChange} options={opts} aria-label="Trip view" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("SegmentedControl is a radiogroup and fires onValueChange", () => {
    const onValueChange = vi.fn();
    render(<SegmentedControl value="a" onValueChange={onValueChange} options={opts} aria-label="View" />);
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(onValueChange).toHaveBeenCalledWith("b");
  });
});
