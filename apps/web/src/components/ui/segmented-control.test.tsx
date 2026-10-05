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

  // W8: the gated invite form's role segments looked live inside their
  // `fieldset disabled`. Each segment is a native button, so `:disabled`
  // reaches it from the fieldset.
  it("greys its segments when they are disabled", () => {
    render(<SegmentedControl value="Timeline" onValueChange={vi.fn()} options={opts} aria-label="Schedule view" />);
    for (const segment of screen.getAllByRole("radio")) {
      expect(segment.className).toContain("disabled:opacity-50");
    }
  });
});
