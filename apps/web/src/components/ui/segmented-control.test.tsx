import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const opts = [
  { value: "Timeline", label: "Timeline" },
  { value: "Calendar", label: "Calendar" },
];

describe("SegmentedControl variants", () => {
  it("defaults to the pill variant (moss track, raised selected pill)", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl value="Timeline" onValueChange={onValueChange} options={opts} aria-label="Schedule view" />,
    );
    const group = screen.getByRole("radiogroup", { name: "Schedule view" });
    expect(group.className).toContain("bg-moss");
  });

  it("subtle variant switches without a moss pill track (#27)", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        variant="subtle"
        value="Timeline"
        onValueChange={onValueChange}
        options={opts}
        aria-label="Schedule view"
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Schedule view" });
    expect(group.className).not.toContain("bg-moss");
    fireEvent.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(onValueChange).toHaveBeenCalledWith("Calendar");
  });
});
