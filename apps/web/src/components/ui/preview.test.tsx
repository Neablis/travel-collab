import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PREVIEW_REGISTRY } from "@/lib/preview-registry";
import { Preview } from "./preview";

describe("Preview", () => {
  // A sentinel nothing else can produce: if this string reaches the chip, the
  // only path it can have taken is the registry.
  const SENTINEL_MILESTONE = "M-SENTINEL-0";

  it("renders children, and the chip shows whatever milestone the registry holds", () => {
    // Why a sentinel and not `PREVIEW_REGISTRY[id].milestone` — CodeRabbit on
    // PR 105, 2026-09-01. (Deliberately "PR 105" and not the hash-prefixed
    // form: the colour wall reads a bare hash plus three digits as a hex
    // literal — KI-2026-08-30. This very comment tripped it once already.)
    // Reading the expected value from the same entry `Preview`
    // reads makes the assertion tautological: a component that ignored the
    // registry and rendered the literal "unplaced" would still pass. This test
    // exists to prove the registry-to-chip data flow, so it has to control the
    // input. (The registry lookup in the container-chip test is NOT this mistake —
    // there the lookup only LOCATES the chip and the assertion is about its
    // position class.)
    //
    // The literal "M9" lived here until 2026-09-01, when retagging
    // `map-legend-modes` to "unplaced" broke a test that has nothing to do with
    // who owns the shell. The sentinel fixes both problems at once: ownership
    // can change freely, and the data flow stays load-bearing.
    //
    // `as const` is compile-time only, so the entry is mutable at runtime.
    const entry = PREVIEW_REGISTRY["add-stop-suggestions"] as { milestone: string };
    const original = entry.milestone;
    entry.milestone = SENTINEL_MILESTONE;
    try {
      render(
        <Preview id="add-stop-suggestions" size="container">
          {<span>rail body</span>}
        </Preview>,
      );
      expect(screen.getByText("rail body")).toBeTruthy();
      expect(screen.getByText(new RegExp(`Preview · ${SENTINEL_MILESTONE}`))).toBeTruthy();
    } finally {
      entry.milestone = original;
    }
  });
  it("inerts interactive controls inside it", async () => {
    const onClick = vi.fn();
    render(
      <Preview id="add-stop-suggestions" size="container">
        <button onClick={onClick}>Ask</button>
      </Preview>,
    );
    await userEvent.click(screen.getByText("Ask")).catch(() => {});
    expect(onClick).not.toHaveBeenCalled();
  });
  it("marks the region aria-disabled", () => {
    render(
      <Preview id="add-stop-suggestions" size="container">
        body
      </Preview>,
    );
    expect(screen.getByRole("group", { hidden: true }).getAttribute("aria-disabled")).toBe("true");
  });
  it("renders an icon badge instead of the text pill when compact", () => {
    render(
      <Preview id="add-stop-suggestions" size="compact">
        body
      </Preview>,
    );
    expect(screen.queryByText(/Preview · M9/)).toBeNull();
  });
  it("reserves space for the compact badge instead of overlapping the host", () => {
    render(
      // Any compact shell will do, and this slot has now been handed on
      // TWICE: "share-button" left the registry when M11 link 4 made Share
      // real, and `wizard-longer-chip` left it on 2026-09-16 when D-B
      // confirmed 21 nights and made Longer a real length chip. Recording the
      // second hand-off the way the first was recorded, because a fixture id
      // that quietly follows whatever is still unbuilt is how this test ends
      // up broken by a change in a file it has nothing to do with.
      <Preview id="add-stop-suggestions" size="compact">
        <button>Share</button>
      </Preview>,
    );
    expect(screen.getByRole("group").className).toMatch(/\bpr-6\b/);
  });
  it("reserves space for the container chip instead of overlapping the host", () => {
    render(
      // `budget-breakdown` was this fixture until 2026-09-26, when the Settings
      // sheet's breakdown became the "Spend by kind" notebook widget and left
      // the registry. Any still-registered id will do: the size is the prop.
      <Preview id="add-stop-suggestions" size="container">
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
    // Read the milestone from the registry rather than spelling it: this
    // assertion is about the chip's POSITION, and hardcoding a tag made it fail
    // when `budget-breakdown` was retagged M11 -> M19 (2026-08-31) — a green
    // suite broken by an edit that changed nothing this test is about.
    expect(
      screen.getByText(new RegExp(`Preview · ${PREVIEW_REGISTRY["add-stop-suggestions"].milestone}`))
        .className,
    ).toMatch(/\btop-1\.5\b/);
  });
  it("does not force position:relative when the caller positions itself", () => {
    render(
      <Preview id="add-stop-suggestions" size="container" className="fixed inset-0">
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
