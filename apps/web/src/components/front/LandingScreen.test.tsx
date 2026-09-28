import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LandingScreen } from "./LandingScreen";

// **The real panels are loaded before any test runs.** The hero `lazy()`-loads
// `LandingHeroPanels` (the board's river, `@tc/pages`), and in a cold Vitest
// worker that first import is a transform of the whole module tree: measured
// at ~1.4s on a 4-core container, against `findBy*`'s 1s default. So the first
// test to open a Timeline or Notebook view failed every time, in the same
// place, and every later one passed off the warm module cache. Importing it
// here makes `lazy()` resolve from that cache, so what these tests measure is
// what the panels draw, not how fast the machine compiles them. A load that
// fails is `LandingHeroArt.failed.test.tsx`'s business, not this file's.
beforeAll(async () => {
  await import("./LandingHeroPanels");
});

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
      within(screen.getByTestId("desktop-landing")).getByRole("heading", { name: "Put the best day on repeat." }),
    ).toBeDefined();
  });

  it("keeps a Sign in link — e2e/helpers.ts drives sign-in through it", () => {
    render(<LandingScreen />);
    expect(within(screen.getByTestId("desktop-landing")).getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  });

  it("sends every primary call to action to sign-up", () => {
    render(<LandingScreen />);
    // "Start a trip" is asked three times — header, hero and closing CTA band —
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
  it("sends both peek-at-a-trip CTAs to the public demo board", () => {
    const { container } = render(<LandingScreen />);
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(container.querySelectorAll("[data-preview-id]")).toHaveLength(0);
    const peek = within(screen.getByTestId("desktop-landing")).getByRole("link", { name: "Look around a real trip" });
    const finished = within(screen.getByTestId("desktop-landing")).getByRole("link", { name: "See a finished one" });
    expect(peek.getAttribute("href")).toBe("/demo");
    expect(finished.getAttribute("href")).toBe("/demo");
  });

  // SPEC §14: the front door runs on nothing. Since the hero's Timeline and
  // Notebook panels became the product's own river and notebook blocks, "no
  // backend" is a property of components that DO fetch elsewhere (a notebook
  // block beside a weather request, a board beside its trip read), so it is
  // held here rather than trusted. The hero mounts one view at a time, so each
  // is opened, and each is asserted to have drawn something real before the
  // spy is read — a view that failed to mount would otherwise pass for free.
  it("calls fetch for nothing while it renders, in any hero view (SPEC §14)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<LandingScreen />);
    const desktop = within(screen.getByTestId("desktop-landing"));

    fireEvent.click(desktop.getByRole("button", { name: "Day 7" }));
    expect(await desktop.findByRole("list", { name: "Day 7 timeline" })).toBeDefined();
    fireEvent.click(desktop.getByRole("button", { name: "Day 5" }));
    expect(await desktop.findByRole("img", { name: /^Days 1–3 Tokyo/ })).toBeDefined();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tells the group how they join, under the hero's buttons", () => {
    render(<LandingScreen />);
    expect(
      within(screen.getByTestId("desktop-landing")).getByText("Invite the group with a link, nothing to install."),
    ).toBeDefined();
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
  it.each([
    ["free", /\bfree\b/i],
    ["open source", /open[ -]source/i],
    ["no credit card", /credit card/i],
  ])("never sells itself on %s (SPEC §14)", (_label, pattern) => {
    render(<LandingScreen />);
    expect(screen.queryAllByText(pattern)).toEqual([]);
  });
});
