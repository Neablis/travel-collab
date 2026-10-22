import { UNBUILT_SOCIAL } from "@/test-support/unbuiltSocial";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LANDING_FEATURES } from "@/lib/landingDemo";
import { LandingScreen } from "./LandingScreen";

// **The real panels are loaded before any test runs.** The sea's moments and
// the phone's claims `lazy()`-load them (the board's river, `@tc/pages`), and
// in a cold Vitest worker that first import is a transform of the whole module
// tree: measured at ~1.4s on a 4-core container, against `findBy*`'s 1s
// default. Importing it here makes `lazy()` resolve from the warm cache, so
// what these tests measure is what the panels draw, not how fast the machine
// compiles them.
beforeAll(async () => {
  await import("./LandingFeaturePanels");
});

/**
 * Waits for the sea's moments' real components, in both trees, so what a test
 * reads next is what a visitor sees once they have arrived.
 */
async function realPanels() {
  for (const tree of ["desktop-landing", "phone-front-door"]) {
    const scope = within(screen.getByTestId(tree));
    expect(await scope.findAllByRole("link", { name: LANDING_FEATURES.shelf.name })).not.toEqual([]);
    expect(await scope.findByRole("list", { name: "Day 2 timeline" })).toBeDefined();
    expect(await scope.findByTestId("notebook-page")).toBeDefined();
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC §28 gives the phone its own front door, and both trees are rendered with
// the breakpoint choosing one (see `LandingScreen.tsx`). A real browser exposes
// exactly one — a `display: none` subtree is not in the accessibility tree —
// but jsdom applies no media queries and sees both, so every query here is
// scoped to the desktop tree by testid. `PhoneFrontDoor.test.tsx` owns the
// other one.
// Every query below is scoped INLINE rather than through a named helper. A
// helper holding the queries reads to `testing-library/prefer-screen-queries`
// exactly like `render`'s own destructured queries — the shape that rule exists
// to stop — and the wall rejects it. Verbose, and the wall is right.


describe("LandingScreen", () => {
  it("leads with the product claim", () => {
    render(<LandingScreen />);
    expect(
      within(screen.getByTestId("desktop-landing")).getByRole("heading", { name: "Plan the trip together." }),
    ).toBeDefined();
  });

  it("keeps a Sign in link — e2e/helpers.ts drives sign-in through it", () => {
    render(<LandingScreen />);
    expect(within(screen.getByTestId("desktop-landing")).getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  });

  it("sends every primary call to action to sign-up", () => {
    render(<LandingScreen />);
    // "Start a trip" is asked three times — header, hero and the closing moment —
    // so this enumerates all three rather than loosening the assertion to the
    // first match.
    const startTrip = within(screen.getByTestId("desktop-landing")).getAllByRole("link", { name: "Start a trip" });
    expect(startTrip).toHaveLength(3);
    for (const link of startTrip) expect(link.getAttribute("href")).toBe("/signup");
  });

  // M11 link 4 retired both shells (`landing-peek-trip`,
  // `landing-see-finished`). They are now two ordinary links to the same
  // place — and it stays an ordinary link, not a fetch: SPEC §14 says this
  // page runs on nothing, so the CTA does not go looking for a trip to peek
  // at. `/demo` decides that, on its own page (ADR-031).
  it("sends the peek-at-a-trip CTA to the public demo board", () => {
    render(<LandingScreen />);
    const peek = within(screen.getByTestId("desktop-landing")).getByRole("link", { name: "Look around a real trip" });
    expect(peek.getAttribute("href")).toBe("/demo");
  });

  // M51 decision 10: pricing second to last, and the last thing on the page
  // the ask, in a full-width cell of the sea: sign up, or find a day to start
  // from. Order is document position, which is what a reader scrolls.
  it("ends the sea on pricing, then the closing cell's two ways in", () => {
    render(<LandingScreen />);
    const desktop = within(screen.getByTestId("desktop-landing"));
    const closingRegion = desktop.getByRole("region", { name: "Start the plan, then bring everyone." });
    const closing = within(closingRegion);
    expect(closing.getByRole("link", { name: "Start a trip" }).getAttribute("href")).toBe("/signup");
    expect(closing.getByRole("link", { name: "Find a day to start with" }).getAttribute("href")).toBe("/playbooks");

    const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const pricing = desktop.getByRole("region", { name: "Pricing" });
    const sea = within(desktop.getByTestId("landing-sea"));
    expect(before(pricing, closingRegion)).toBe(true);
    for (const cell of sea.getAllByTestId("discover-card")) expect(before(cell, pricing)).toBe(true);
    for (const name of ["Find a day worth borrowing.", "Keep the notebook afterwards."]) {
      expect(before(sea.getByRole("region", { name }), pricing)).toBe(true);
    }
    expect(sea.getByRole("region", { name: "Start the plan, then bring everyone." })).toBe(closingRegion);
  });

  // SPEC §14: the front door runs on nothing. The sea's moments are the
  // product's own river, notebook blocks and Discover cards, components that
  // DO fetch elsewhere (a notebook block beside a weather request, a board
  // beside its trip read), so "no backend" is held here rather than trusted,
  // after each has drawn something real: a moment that failed to mount would
  // otherwise pass for free.
  it("calls fetch for nothing while it renders, in the sea or any moment (SPEC §14)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<LandingScreen />);
    await realPanels();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tells the group how they join, under the hero's buttons", () => {
    render(<LandingScreen />);
    expect(
      within(screen.getByTestId("desktop-landing")).getByText("Invite the group with a link, nothing to install."),
    ).toBeDefined();
  });

  // ADR-061: the playbook library is open without an account, so the front
  // door links it (Mitchell, 2026-10-02).
  it("links the playbook library from the header", () => {
    render(<LandingScreen />);
    expect(within(screen.getByTestId("desktop-landing")).getByRole("link", { name: "Playbooks" }).getAttribute("href")).toBe(
      "/playbooks",
    );
  });

  // M42 D3: the plans and their prices at an anchor the header and any
  // outside link can reach. A summary, not `/plans`' comparison table —
  // Mitchell, 2026-10-11: *"the specifics are for the actual payment page"*.
  it("summarises the plans at #pricing, linked from the header", () => {
    render(<LandingScreen />);
    const desktop = within(screen.getByTestId("desktop-landing"));
    const pricing = desktop.getByRole("region", { name: "Pricing" });
    expect(pricing.id).toBe("pricing");
    expect(within(pricing).queryByRole("table")).toBeNull();
    expect(within(pricing).getAllByTestId("plan-step")).toHaveLength(2);
    expect(within(pricing).getByRole("link", { name: "Compare plans" }).getAttribute("href")).toBe(
      "/signin?callbackUrl=%2Fplans",
    );
    expect(desktop.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("#pricing");
  });

  it("links the developers page from the footer", () => {
    render(<LandingScreen />);
    const footer = within(within(screen.getByTestId("desktop-landing")).getByRole("contentinfo"));
    expect(footer.getByRole("link", { name: "Developers" }).getAttribute("href")).toBe("/developers");
  });

  it("ends on a footer with the contact address", () => {
    render(<LandingScreen />);
    const footer = within(within(screen.getByTestId("desktop-landing")).getByRole("contentinfo"));
    expect(footer.getByText("© 2026 Caesura")).toBeDefined();
    expect(footer.getByRole("link", { name: "mitchell@demarcosoftware.com" }).getAttribute("href")).toBe(
      "mailto:mitchell@demarcosoftware.com",
    );
  });

  // SPEC §14, copy rules: no "free", no "open source", no "no credit card" —
  // Caesura is a product for groups, not a tool. The 2026-09-28 retro put
  // "Free during early access" on the page and Mitchell took it back off on
  // the preview ("there will always be a free" tier, so it promised the wrong
  // thing); this is the guard that keeps it off. Word-bounded because the
  // Playbooks fixture legitimately reads "Sunrise, Freedom Beach"
  // (`dc.html:2169`).
  //
  // **Matched per element, not against `container.textContent`.** The whole
  // page's text is its elements' text glued together with no separator, so a
  // "Free …" kicker straight after the header's "Start a trip" reads as
  // "tripFree" — no word boundary, no match. The old form passed with exactly
  // that planted; `queryAllByText` tests each element's own text.
  //
  // **Except the plan's name in the plan summary**: the `free` card's name and
  // its "Free" price. SPEC §17.1: *"The `Free` plan name is not that claim"*.
  // Only an element that is exactly the name is let through — "Free for a
  // week" on a card is still a claim — and the other two patterns get no
  // exemption at all.
  //
  // **No exclamation mark** either (M51 decision 6): *"the exclamation mark
  // undermines the authenticity and tone im looking for"*.
  it.each([
    ["free", /\bfree\b/i],
    ["open source", /open[ -]source/i],
    ["no credit card", /credit card/i],
    ["an exclamation mark", /!/],
  ])("never sells itself on %s (SPEC §14)", (_label, pattern) => {
    render(<LandingScreen />);
    const planNames = screen
      .getAllByTestId("plan-summary")
      .flatMap((table) => within(table).queryAllByText(/^free$/i));
    // The sea's cards are days people wrote ("Carnavalet, the free museum"),
    // not the page selling itself, so their words are theirs.
    const days = screen.queryAllByTestId("discover-card").flatMap((card) => within(card).queryAllByText(pattern));
    expect(screen.queryAllByText(pattern).filter((el) => !planNames.includes(el) && !days.includes(el))).toEqual([]);
  });

  // Mitchell, 2026-10-11: the landing draws what the app does. Trips have no
  // replies, votes, comments, reactions or live presence — they have
  // suggestions and a history of who changed what, and the public library
  // has stars — so neither tree may picture the rest. Both trees, because the
  // phone front door carries its own cards, and once their real components
  // have arrived, because those are what a visitor reads.
  it("pictures no replies, votes, reactions or presence, which trips do not have", async () => {
    render(<LandingScreen />);
    await realPanels();
    expect(screen.queryAllByText(UNBUILT_SOCIAL).map((el) => el.textContent)).toEqual([]);
    expect(screen.queryAllByRole("img", { name: UNBUILT_SOCIAL })).toEqual([]);
  });
});
