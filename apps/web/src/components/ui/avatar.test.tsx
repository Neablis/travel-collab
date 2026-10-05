import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./avatar";

describe("Avatar", () => {
  it("draws the member's initials from initialsFor when none are given", () => {
    render(<Avatar name="dev-alice" data-testid="a" />);
    expect(screen.getByTestId("a").textContent).toBe("DA");
  });

  // The invite landing has no ids, only display names, and its own rule
  // ("Alice" → "A") differs from initialsFor's ("Alice" → "AL"). Adopting the
  // primitive must not change what it draws.
  it("draws the caller's initials verbatim when given", () => {
    render(<Avatar name="Alice" initials="A" data-testid="a" />);
    expect(screen.getByTestId("a").textContent).toBe("A");
  });

  it("draws the icon instead of initials for a row that is not a person", () => {
    render(<Avatar name="Link invite" icon={<svg data-testid="glyph" />} data-testid="a" />);
    expect(screen.getByTestId("glyph")).toBeTruthy();
    expect(screen.getByTestId("a").textContent).toBe("");
  });
});
