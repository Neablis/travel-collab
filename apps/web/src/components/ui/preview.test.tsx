import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Preview } from "./preview";

describe("Preview", () => {
  it("renders children and a milestone chip", () => {
    render(
      <Preview id="assistant-suggestions" size="container">
        {<span>rail body</span>}
      </Preview>,
    );
    expect(screen.getByText("rail body")).toBeTruthy();
    expect(screen.getByText(/Preview · M9/)).toBeTruthy();
  });
  it("inerts interactive controls inside it", async () => {
    const onClick = vi.fn();
    render(
      <Preview id="assistant-suggestions" size="container">
        <button onClick={onClick}>Ask</button>
      </Preview>,
    );
    await userEvent.click(screen.getByText("Ask")).catch(() => {});
    expect(onClick).not.toHaveBeenCalled();
  });
  it("marks the region aria-disabled", () => {
    render(
      <Preview id="assistant-suggestions" size="container">
        body
      </Preview>,
    );
    expect(screen.getByRole("group", { hidden: true }).getAttribute("aria-disabled")).toBe("true");
  });
  it("renders an icon badge instead of the text pill when compact", () => {
    render(
      <Preview id="assistant-suggestions" size="compact">
        body
      </Preview>,
    );
    expect(screen.queryByText(/Preview · M9/)).toBeNull();
  });
  it("reserves space for the compact badge instead of overlapping the host", () => {
    render(
      <Preview id="share-button" size="compact">
        <button>Share</button>
      </Preview>,
    );
    expect(screen.getByRole("group").className).toMatch(/\bpr-6\b/);
  });
  it("does not force position:relative when the caller positions itself", () => {
    render(
      <Preview id="assistant-suggestions" size="container" className="fixed inset-0">
        <p>x</p>
      </Preview>,
    );
    const group = screen.getByRole("group");
    // Assert the caller's own positioning survives, not just that `relative`
    // is absent — that weaker check would also pass if the whole className
    // were dropped (CodeRabbit, PR #35).
    expect(group.className).toMatch(/\bfixed\b/);
    expect(group.className).toMatch(/\binset-0\b/);
    expect(group.className).not.toMatch(/\brelative\b/);
  });
});
