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
// The shelf's second day, from `content/playbooks/thailand-beaches.json`.
const RAILAY = "Railay: the first longtail, Phra Nang before the crowd, and back after dark";

describe("LandingFeatureBlocks", () => {
  it.each(["Playbooks", "Together", "Countdown", "Notebook"])("names the %s block", (eyebrow) => {
    render(<LandingFeatureBlocks />);
    expect(screen.getByText(eyebrow)).toBeDefined();
  });

  // In page order, because the retro's order is the argument: the feeling
  // (Playbooks) first, the mechanics riding along after it. Each block is a
  // region named by its title, which is also how the tests below find one.
  //
  // And with M50 part 5's shape named on each: a full-bleed spread, a wide
  // card beside a narrow one, a spread again. These are labels, not the
  // layout: `m42-demo-trips.spec.ts` exempts the spreads from the card width
  // cap by `data-layout="spread"`, and `responsive.spec.ts` measures the
  // shapes themselves in a browser.
  it("puts the blocks in the retro's order, as spread, wide, narrow, spread", () => {
    render(<LandingFeatureBlocks />);
    expect(
      screen
        .getAllByRole("region")
        .map((region) => [within(region).getAllByRole("heading")[0]?.textContent, region.getAttribute("data-layout")]),
    ).toEqual([
      [PLAYBOOKS, "spread"],
      [TOGETHER, "wide"],
      [COUNTDOWN, "narrow"],
      [NOTEBOOK, "spread"],
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
  // day, the credit and its author. The shelf's second day stands first in
  // the reading order, under the copy, and has no cover to credit.
  it("shows Mitchell's playbook as Discover draws it, with its cover, description and tags", async () => {
    render(<LandingFeatureBlocks />);
    const playbooks = within(screen.getByRole("region", { name: PLAYBOOKS }));
    await playbooks.findByRole("link", { name: LANDING_FEATURES.playbook.name });
    await playbooks.findByRole("link", { name: RAILAY });
    expect(playbooks.getByRole("img", { name: "a group of people walking down a train track" })).toBeDefined();
    expect(playbooks.getByText("Outdoors & food")).toBeDefined();
    // Both days carry the tag, each card its own chip.
    expect(playbooks.getAllByText("Outdoors")).toHaveLength(2);
    expect(playbooks.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Krabi",
      RAILAY,
      "Nadia",
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

  // Mitchell's walk of production (M50 part 9): the spread held an empty mat
  // where a photo was to go. It is a shelf of two real days instead, each as
  // Discover draws it; the second is a bundled playbook the library serves, at
  // the id the importer gives it, so its link opens the day in production.
  it("shelves a second real playbook beside Mitchell's", async () => {
    render(<LandingFeatureBlocks />);
    const playbooks = within(screen.getByRole("region", { name: PLAYBOOKS }));
    const railay = await playbooks.findByRole("link", { name: RAILAY });
    expect(railay.getAttribute("href")).toMatch(/^\/playbooks\/day\/railay-[a-z0-9-]+-95742081-a970-48b2-8779-34d5104c94ca/);
    expect(playbooks.getByRole("link", { name: LANDING_FEATURES.playbook.name })).toBeDefined();
  });

  // The same walk: the notebook page was a strip and two paragraphs in a frame
  // twice their height. It is a diary page now, drawn by the notebook's own
  // widgets: the day's stops with their times, its daylight, and who was there.
  it("fills the notebook page with the day's stops, its daylight and the people on it", async () => {
    render(<LandingFeatureBlocks />);
    const notebook = within(screen.getByRole("region", { name: NOTEBOOK }));
    const stops = within(await notebook.findByRole("list"));
    expect(stops.getAllByRole("listitem")).toHaveLength(5);
    expect(stops.getByText("Kaiseki dinner at the ryokan")).toBeDefined();
    expect(notebook.getByRole("table", { name: /^Sunrise and sunset for 1 day/ })).toBeDefined();
    expect(notebook.getByText(/are going with Sam\.$/)).toBeDefined();
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
    // Once in the words, as the widget the author wrote, and once as the day's stop.
    expect(await notebook.findAllByText("Check in at Gora Kadan")).toHaveLength(2);
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
