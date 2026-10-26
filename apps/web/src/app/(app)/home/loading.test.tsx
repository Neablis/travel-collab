import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomeLoading from "./loading";

// Without a loading boundary a link to Home held the page it came from until
// Home's server read answered: a frozen page, not a loading one (M54 part 4).
describe("Home's loading boundary", () => {
  it("paints the hero's and the grid's own skeletons at the click", () => {
    render(<HomeLoading />);
    expect(screen.getByRole("status", { name: "Loading your next trip" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading your trips" })).toBeTruthy();
  });
});
