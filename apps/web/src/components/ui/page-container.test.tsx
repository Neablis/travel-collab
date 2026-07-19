import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageContainer } from "./page-container";

describe("PageContainer", () => {
  it("centers content and applies the content max-width by default", () => {
    render(<PageContainer data-testid="pc">body</PageContainer>);
    const el = screen.getByTestId("pc");
    expect(el.className).toContain("mx-auto");
    expect(el.className).toContain("max-w-content");
  });

  it("full width applies no max-width", () => {
    render(<PageContainer width="full" data-testid="pc">body</PageContainer>);
    expect(screen.getByTestId("pc").className).not.toContain("max-w-content");
  });

  it("renders as <main> when asked", () => {
    render(<PageContainer as="main" data-testid="pc">body</PageContainer>);
    expect(screen.getByTestId("pc").tagName).toBe("MAIN");
  });
});
