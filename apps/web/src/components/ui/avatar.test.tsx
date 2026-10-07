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

  // M38's xs is additive: the three sizes that shipped before it must draw
  // exactly what they did.
  it("draws a 20px circle at xs and leaves the other sizes as they were", () => {
    const classesFor = (size: "xs" | "sm" | "md" | "lg"): string => {
      render(<Avatar name="dev-alice" size={size} data-testid={size} />);
      return screen.getByTestId(size).className;
    };
    expect(classesFor("xs")).toContain("size-5 text-xs");
    expect(classesFor("sm")).toContain("size-7 text-xs");
    expect(classesFor("md")).toContain("size-7.5 text-xs");
    expect(classesFor("lg")).toContain("size-11 text-md");
  });

  it("draws the icon instead of initials for a row that is not a person", () => {
    render(<Avatar name="Link invite" icon={<svg data-testid="glyph" />} data-testid="a" />);
    expect(screen.getByTestId("glyph")).toBeTruthy();
    expect(screen.getByTestId("a").textContent).toBe("");
  });
});
