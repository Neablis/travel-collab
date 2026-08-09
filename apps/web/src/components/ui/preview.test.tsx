import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Preview } from "./preview";

describe("Preview", () => {
  it("renders children and a milestone chip", () => {
    render(<Preview id="assistant-rail">{<span>rail body</span>}</Preview>);
    expect(screen.getByText("rail body")).toBeTruthy();
    expect(screen.getByText(/Preview · M9/)).toBeTruthy();
  });
  it("inerts interactive controls inside it", async () => {
    const onClick = vi.fn();
    render(
      <Preview id="assistant-rail">
        <button onClick={onClick}>Ask</button>
      </Preview>,
    );
    await userEvent.click(screen.getByText("Ask")).catch(() => {});
    expect(onClick).not.toHaveBeenCalled();
  });
  it("marks the region aria-disabled", () => {
    render(<Preview id="assistant-rail">body</Preview>);
    expect(screen.getByRole("group", { hidden: true }).getAttribute("aria-disabled")).toBe("true");
  });
});
