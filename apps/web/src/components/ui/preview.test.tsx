import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Preview } from "./preview";

describe("Preview", () => {
  it("renders children and a milestone chip", () => {
    render(
      <Preview id="assistant-quick-asks" size="container">
        {<span>rail body</span>}
      </Preview>,
    );
    expect(screen.getByText("rail body")).toBeTruthy();
    expect(screen.getByText(/Preview · M9/)).toBeTruthy();
  });
  it("inerts interactive controls inside it", async () => {
    const onClick = vi.fn();
    render(
      <Preview id="assistant-quick-asks" size="container">
        <button onClick={onClick}>Ask</button>
      </Preview>,
    );
    await userEvent.click(screen.getByText("Ask")).catch(() => {});
    expect(onClick).not.toHaveBeenCalled();
  });
  it("marks the region aria-disabled", () => {
    render(
      <Preview id="assistant-quick-asks" size="container">
        body
      </Preview>,
    );
    expect(screen.getByRole("group", { hidden: true }).getAttribute("aria-disabled")).toBe("true");
  });
  it("renders an icon badge instead of the text pill when compact", () => {
    render(
      <Preview id="assistant-quick-asks" size="compact">
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
  it("reserves space for the container chip instead of overlapping the host", () => {
    render(
      <Preview id="budget-breakdown" size="container">
        <span>$4,088.25</span>
      </Preview>,
    );
    // KI-45: `container` used to reserve nothing, on the theory that a chip
    // inset to the border lands on the dotted border rather than on content.
    // Measured in Chromium against the real SettingsSheet markup, it landed
    // on Booked's $4,088.25 (58.36x12.19px of overlap), the "Invite someone"
    // button (92.92x4.31px) and the wizard's "Back to Kyoto" chip
    // (9.80x18.50px). jsdom has no layout, so this asserts the two halves of
    // the pairing the browser measurement pinned down instead of the pixels:
    // the chip's own inset (`top-1.5` = 6px) and a gutter big enough to clear
    // it (`pt-7` = 28px >= 6px + the chip's measured 18.5px height). Changing
    // either one alone re-opens the overlap, so both are asserted here.
    expect(screen.getByRole("group").className).toMatch(/\bpt-7\b/);
    expect(screen.getByText(/Preview · M11/).className).toMatch(/\btop-1\.5\b/);
  });
  it("does not force position:relative when the caller positions itself", () => {
    render(
      <Preview id="assistant-quick-asks" size="container" className="fixed inset-0">
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
