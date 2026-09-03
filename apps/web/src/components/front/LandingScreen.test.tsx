import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingScreen } from "./LandingScreen";

afterEach(cleanup);

describe("LandingScreen", () => {
  it("leads with the product claim", () => {
    render(<LandingScreen />);
    expect(
      screen.getByRole("heading", { name: "The trip everyone actually helped plan." }),
    ).toBeDefined();
  });

  it("keeps a Sign in link — e2e/helpers.ts drives sign-in through it", () => {
    render(<LandingScreen />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  });

  it("sends every primary call to action to sign-up", () => {
    render(<LandingScreen />);
    // "Start a trip" is asked twice — header and closing CTA band — so this
    // enumerates both rather than loosening the assertion to the first match.
    const startTrip = screen.getAllByRole("link", { name: "Start a trip" });
    expect(startTrip).toHaveLength(2);
    for (const link of startTrip) expect(link.getAttribute("href")).toBe("/signup");
    expect(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href")).toBe("/signup");
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
    const peek = screen.getByRole("link", { name: "Look around a real trip" });
    const finished = screen.getByRole("link", { name: "See a finished one" });
    expect(peek.getAttribute("href")).toBe("/demo");
    expect(finished.getAttribute("href")).toBe("/demo");
  });

  it("carries the Early access footnote", () => {
    render(<LandingScreen />);
    expect(screen.getByText(/Early access/)).toBeDefined();
  });

  it("names what the page is for", () => {
    render(<LandingScreen />);
    expect(
      screen.getByRole("heading", { name: "Planning is the trip, three times over." }),
    ).toBeDefined();
  });

  // SPEC §14, copy rules: no "free", no "open source", no "no credit card" —
  // Caesura is a product for groups, not a tool, and the only footnote is
  // "Early access". The page shipped all three of those before this pass;
  // this is the guard that stops the old positioning creeping back.
  // `free` is word-bounded on purpose: the Playbooks block's fixture copy
  // legitimately reads "Sunrise, Freedom Beach" (`dc.html:2169`).
  it.each([
    ["free", /\bfree\b/i],
    ["open source", /open[ -]source/i],
    ["no credit card", /credit card/i],
  ])("never sells itself on %s (SPEC §14)", (_label, pattern) => {
    const { container } = render(<LandingScreen />);
    expect(container.textContent ?? "").not.toMatch(pattern);
  });
});
