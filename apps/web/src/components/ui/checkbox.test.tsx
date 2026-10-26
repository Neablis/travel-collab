import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";

// M54: ticking a box eases the tick in. It used to be `hidden` until checked,
// and `display` cannot transition, so the tick snapped whatever the timing
// said. It now stays laid out and the checked state drives its scale and
// opacity, with no scale under reduced motion (ADR-082 §1).
describe("Checkbox", () => {
  it("keeps the tick laid out and eases it in from the checked state", () => {
    render(<Checkbox aria-label="Read trips" defaultChecked={false} />);
    // An SVG's `className` is not a string, so the attribute is read instead.
    const classes = (screen.getByTestId("checkbox-tick").getAttribute("class") ?? "").split(" ");

    expect(classes).not.toContain("hidden");
    expect(classes).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "scale-50",
        "peer-checked:opacity-100",
        "peer-checked:scale-100",
        "transition",
        "duration-fast",
        "motion-reduce:scale-100",
      ]),
    );
  });
});
