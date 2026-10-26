import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AccountLoading from "./loading";

// A link to Account used to hold the page it came from until the route
// answered (M54 part 4): the boundary is what paints something at the click.
describe("Account's loading boundary", () => {
  it("draws the page's real heading over a skeleton region", () => {
    render(<AccountLoading />);
    expect(screen.getByRole("heading", { level: 1, name: "Account" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading your account" })).toBeTruthy();
  });
});
