import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  // `art` is where a surface's illustration goes (M50 part 6), and it leads:
  // above the icon and the heading.
  it("draws a caller's art first, before the icon and the heading", () => {
    render(
      <EmptyState
        art={<span data-testid="art" />}
        icon={<span data-testid="icon" />}
        title="Nothing here yet"
      />,
    );
    const art = screen.getByTestId("art");
    const follows = (node: Node) => art.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows(screen.getByTestId("icon"))).toBeTruthy();
    expect(follows(screen.getByRole("heading", { name: "Nothing here yet" }))).toBeTruthy();
  });
});
