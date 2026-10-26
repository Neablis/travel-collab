import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PlansLoading from "./loading";

// A link to Plans used to hold the page it came from until the route answered
// (M54 part 4): the boundary is what paints something at the click.
describe("Plans' loading boundary", () => {
  it("draws the page's real heading over a skeleton region", () => {
    render(<PlansLoading />);
    expect(screen.getByRole("heading", { level: 1, name: "Plans" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading your plans" })).toBeTruthy();
  });
});
