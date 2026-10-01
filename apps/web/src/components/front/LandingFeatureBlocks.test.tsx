import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingFeatureBlocks } from "./LandingFeatureBlocks";

afterEach(cleanup);

describe("LandingFeatureBlocks", () => {
  it.each(["Playbooks", "Together", "Countdown", "Notebook"])("names the %s block", (eyebrow) => {
    render(<LandingFeatureBlocks />);
    expect(screen.getByText(eyebrow)).toBeDefined();
  });

  it.each([
    "Relive someone’s perfect day.",
    "The trip starts before the trip.",
    "Too excited to sleep.",
    "How you’ll remember it.",
  ])("titles the block %s", (title) => {
    render(<LandingFeatureBlocks />);
    expect(screen.getByRole("heading", { name: title })).toBeDefined();
  });

  // The handoff contradicts itself here and the contradiction is resolved, not
  // open: SPEC §14 says the Day 6 total is $596, the design file
  // (`dc.html:2124-2133`) lists $340 + $210 and labels the total $550. The
  // design file is authoritative for copy and is the one that adds up, so $550
  // is correct. This assertion exists so nobody reading SPEC §14 alone
  // "corrects" it back to $596.
  it("adds the notebook's cost table up to $550, not SPEC §14's $596", () => {
    render(<LandingFeatureBlocks />);
    expect(screen.getByText("$340")).toBeDefined();
    expect(screen.getByText("$210")).toBeDefined();
    expect(screen.getByText("Day total")).toBeDefined();
    expect(screen.getByText("$550")).toBeDefined();
    expect(screen.queryByText("$596")).toBeNull();
  });

  it("shows the borrowed playbook's rating and reach", () => {
    render(<LandingFeatureBlocks />);
    expect(screen.getByText("4.8")).toBeDefined();
    expect(screen.getByText("Relived 214 times")).toBeDefined();
  });

  // In page order, because the retro's order is the argument: the feeling
  // (Playbooks) first, the mechanics riding along after it.
  it("puts the blocks in the retro's order", () => {
    render(<LandingFeatureBlocks />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Relive someone’s perfect day.",
      "The trip starts before the trip.",
      "Too excited to sleep.",
      "How you’ll remember it.",
    ]);
  });

  it("counts the trip down to tomorrow and marks the steps already passed", () => {
    render(<LandingFeatureBlocks />);
    expect(screen.getByText("Wheels up tomorrow.")).toBeDefined();
    expect(screen.getByText("day to go")).toBeDefined();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["One month", "One week", "Tomorrow"]);
  });

  it("lets the group mark the stop they can't wait for", () => {
    render(<LandingFeatureBlocks />);
    expect(screen.getByRole("img", { name: "Can't wait" })).toBeDefined();
  });

  it("marks the booked stop and the maybe on the Together timeline", () => {
    render(<LandingFeatureBlocks />);
    expect(screen.getByText("Pending")).toBeDefined();
    expect(screen.getByText("Idea")).toBeDefined();
    expect(screen.getByText("Pontocho, maybe")).toBeDefined();
  });

  // DRIFT §2: the Notebook's macro values and playbook sharing are unbuilt, and
  // showing them is deliberate — a landing page states direction. Only the two
  // *interactive* dead ends get Preview shells, and LandingScreen owns both.
  // Nothing in this file is interactive, so nothing in it may become a shell.
  it("wraps nothing in a Preview shell", () => {
    const { container } = render(<LandingFeatureBlocks />);
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(container.querySelector("[data-preview-id]")).toBeNull();
  });
});
