import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LANDING_FEATURES } from "@/lib/landingDemo";
import { LandingFeatureBlocks } from "./LandingFeatureBlocks";

// **The real panels are loaded before any test runs**, for the reason
// `LandingHeroArt.test.tsx` gives: the blocks `lazy()`-load the river, the
// Discover card and the notebook blocks, and a cold worker's first transform of
// that tree outruns `findBy*`'s default. A load that fails is
// `LandingFeatureBlocks.failed.test.tsx`'s business.
beforeAll(async () => {
  await import("./LandingFeaturePanels");
});

afterEach(cleanup);

const PLAYBOOKS = "Relive someone’s perfect day.";
const TOGETHER = "The trip starts before the trip.";
const COUNTDOWN = "Too excited to sleep.";
const NOTEBOOK = "How you’ll remember it.";

describe("LandingFeatureBlocks", () => {
  it.each(["Playbooks", "Together", "Countdown", "Notebook"])("names the %s block", (eyebrow) => {
    render(<LandingFeatureBlocks />);
    expect(screen.getByText(eyebrow)).toBeDefined();
  });

  // In page order, because the retro's order is the argument: the feeling
  // (Playbooks) first, the mechanics riding along after it. Each block is a
  // region named by its title, which is also how the tests below find one.
  it("puts the blocks in the retro's order", () => {
    render(<LandingFeatureBlocks />);
    expect(screen.getAllByRole("region").map((region) => within(region).getAllByRole("heading")[0]?.textContent)).toEqual([
      PLAYBOOKS,
      TOGETHER,
      COUNTDOWN,
      NOTEBOOK,
    ]);
  });

  // M42 part 9: the blocks show the app, not a drawing of it (Mitchell's
  // suggestion, which the real hero did half of). The drawings stay, as what
  // stands in while the real components load or if they cannot, so "the block
  // rendered" proves nothing: each block is asserted to hold the real thing and
  // no longer the drawing once the snapshot's components have arrived.
  it("draws the real river, Discover card and notebook page in place of the drawings", async () => {
    render(<LandingFeatureBlocks />);

    const together = within(screen.getByRole("region", { name: TOGETHER }));
    expect(await together.findByRole("list", { name: "Day 7 timeline" })).toBeDefined();
    expect(together.queryByText("Pontocho, maybe")).toBeNull();

    const playbooks = within(screen.getByRole("region", { name: PLAYBOOKS }));
    expect(await playbooks.findByRole("link", { name: LANDING_FEATURES.playbook.name })).toBeDefined();
    expect(playbooks.queryByText("A perfect Phuket beach day")).toBeNull();

    const notebook = within(screen.getByRole("region", { name: NOTEBOOK }));
    expect(await notebook.findByRole("img", { name: /^Days 1–3 Tokyo/ })).toBeDefined();
    expect(notebook.queryByText("Sam started this page")).toBeNull();
  });

  // The river is the board's own, read-only: a stop the demo puts on Day 7, at
  // its time, and no control that would open an editor nobody can use here.
  it("draws the demo trip's Day 7 on the board's read-only river", async () => {
    render(<LandingFeatureBlocks />);
    const river = within(await within(screen.getByRole("region", { name: TOGETHER })).findByRole("list", { name: "Day 7 timeline" }));
    expect(river.getByText(/^Dinner at Gion Nanba, 7 pm – 9 pm, Maybe/)).toBeDefined();
    expect(river.queryAllByRole("button")).toHaveLength(0);
  });

  // The card is Discover's, so it says what Discover would: what kind of day
  // it is (M42 D8), its tags, how many trips took it, and its cover with the
  // photographer's credit (Unsplash's guidelines). Its tags are plain chips —
  // a landing card sends nobody into tag pages, which Discover's card links
  // for the tags its description names — so its ways out are its cities, the
  // day, the credit and its author.
  it("shows Mitchell's playbook as Discover draws it, with its cover, description and tags", async () => {
    render(<LandingFeatureBlocks />);
    const playbooks = within(screen.getByRole("region", { name: PLAYBOOKS }));
    await playbooks.findByRole("link", { name: LANDING_FEATURES.playbook.name });
    expect(playbooks.getByRole("img", { name: "a group of people walking down a train track" })).toBeDefined();
    expect(playbooks.getByText("Outdoors & food")).toBeDefined();
    expect(playbooks.getByText("Outdoors")).toBeDefined();
    expect(playbooks.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Hanoi",
      "Ninh Bình",
      "Tam Cốc",
      LANDING_FEATURES.playbook.name,
      "Elric Pxl",
      "Unsplash",
      "Neablis",
    ]);
    expect(playbooks.getByText("Added to 12 trips")).toBeDefined();
  });

  // Mitchell, 2026-10-11: the front door's example day carries a rating, seeded
  // into the landing's snapshot only, rather than "No reviews yet".
  it("rates the playbook as its reviews would", async () => {
    render(<LandingFeatureBlocks />);
    const playbooks = within(screen.getByRole("region", { name: PLAYBOOKS }));
    await playbooks.findByRole("link", { name: LANDING_FEATURES.playbook.name });
    expect(playbooks.getByText("4.7 · 23 reviews")).toBeDefined();
    expect(playbooks.queryByText("No reviews yet")).toBeNull();
  });

  // Mitchell, 2026-10-11: *"it should be more nostalgic than how much you
  // spent on dinner."* The Notebook used to be a day's cost table; it is a page
  // of the day as it was lived, with the plan's own facts in it as widget
  // values. Nor does any other block print a price, on screen or to a screen
  // reader: the Playbooks card has no total, and the river's stops, whose
  // accessible names would read their prices, are snapshotted with none.
  it("remembers the day in the notebook, with no price in any block", async () => {
    render(<LandingFeatureBlocks />);
    const notebook = within(screen.getByRole("region", { name: NOTEBOOK }));
    expect(await notebook.findByText("Check in at Gora Kadan")).toBeDefined();
    expect(notebook.getByText(/best night of the trip/)).toBeDefined();
    await within(screen.getByRole("region", { name: PLAYBOOKS })).findByRole("link", { name: LANDING_FEATURES.playbook.name });
    await within(screen.getByRole("region", { name: TOGETHER })).findByRole("list", { name: "Day 7 timeline" });
    for (const title of [NOTEBOOK, PLAYBOOKS, TOGETHER]) {
      expect(screen.getByRole("region", { name: title }).textContent).not.toMatch(/[$€£¥฿]\s?\d/);
    }
    expect(screen.queryByText(/\bcosts?\b/i)).toBeNull();
  });

  // Countdown stays a drawing: `NextTripHero` fetches its trip and reads the
  // clock, and the landing does neither (SPEC §14). A countdown offers no
  // Accept, so its drawing draws none (review of PR 405).
  it("counts the trip down to tomorrow and marks the steps already passed", () => {
    render(<LandingFeatureBlocks />);
    const countdown = within(screen.getByRole("region", { name: COUNTDOWN }));
    expect(countdown.getByText("Wheels up tomorrow.")).toBeDefined();
    expect(countdown.getByText("day to go")).toBeDefined();
    expect(countdown.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["One month", "One week", "Tomorrow"]);
    expect(countdown.queryByText("Accept")).toBeNull();
  });

  // DRIFT §2: only the two *interactive* dead ends get Preview shells, and
  // LandingScreen owns both. Nothing in this file may become a shell.
  it("wraps nothing in a Preview shell", () => {
    const { container } = render(<LandingFeatureBlocks />);
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(container.querySelector("[data-preview-id]")).toBeNull();
  });
});
