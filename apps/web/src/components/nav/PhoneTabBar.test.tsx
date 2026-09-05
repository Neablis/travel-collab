import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The failure mode this file exists for: PhoneTabBar's selected tab is derived
// from the route, and SPEC §13 / DRIFT build-check 4 say it must stay that way
// ("'Trips' is not a storable tab value … the phone must never hold tab state
// that can disagree with the route"). If someone replaces the derivation with
// a `useState` — the obvious way to write a tab bar — every one of these
// assertions still *looks* satisfiable, because a fresh mount initialises the
// state correctly. What breaks is the second render at a new URL with no
// click: that is what `renderAt` re-renders below, and it is the shape of
// every desync this rule is about.
//
// Route is the whole input, so `next/navigation` is the whole mock — the same
// two hooks LensRouter reads, driven from a plain URL string.
let url = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => url.split("?")[0]!,
  useSearchParams: () => new URLSearchParams(url.split("?")[1] ?? ""),
}));

import { PhoneTabBar } from "./PhoneTabBar";

afterEach(cleanup);

function renderAt(at: string) {
  url = at;
  cleanup();
  return render(<PhoneTabBar />);
}

/** Every tab, links and disabled buttons alike. */
function tabs() {
  return [...screen.queryAllByRole("link"), ...screen.queryAllByRole("button")];
}

/** The label of the one tab marked current, or null. Fails loudly on two. */
function currentTab(): string | null {
  const marked = tabs().filter((el) => el.getAttribute("aria-current") === "page");
  expect(marked.length).toBeLessThanOrEqual(1);
  return marked[0]?.textContent ?? null;
}

describe("PhoneTabBar", () => {
  // SPEC §22 (2026-09-05): the bar is scoped, not five tabs with three
  // disabled. Both scopes asserted as a whole list rather than by membership —
  // a build that showed the trip three PLUS the account pair would satisfy any
  // "is Plan present" check, and the whole point of §22 is what is absent.
  it("shows the trip's three views inside a trip, in order", () => {
    renderAt("/trips/t1");
    expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual(["Plan", "Map", "Notebook"]);
  });

  it("shows the account pair outside a trip, in order", () => {
    renderAt("/playbooks");
    expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual(["Trips", "Playbooks"]);
  });

  // The design file's own predicate (`…dc.html:7218-7220`), route by route.
  // The two rows worth reading twice are `/playbooks/board` and
  // `/playbooks/profile/…`: the design puts the leaderboard and a public
  // profile under **Trips**, not Playbooks, and its comment at `:7205` says
  // why the arms are enumerated rather than defaulted — "Trips must not fall
  // through to 'anything that isn't a trip'". `/invite/<token>` is the proof
  // of that: a route no tab owns selects nothing.
  it.each([
    ["/", "Trips"],
    ["/playbooks", "Playbooks"],
    ["/playbooks/day/d1", "Playbooks"],
    ["/playbooks/board", "Trips"],
    ["/playbooks/profile/u1", "Trips"],
    ["/trips/t1", "Plan"],
    ["/trips/t1?lens=Schedule&view=Timeline", "Plan"],
    ["/trips/t1?lens=Board", "Plan"],
    ["/trips/t1?lens=Map", "Map"],
    ["/trips/t1/pages", "Notebook"],
    ["/trips/t1/pages/p1", "Notebook"],
    ["/invite/tok", null],
  ])("selects %s → %s", (at, expected) => {
    renderAt(at);
    expect(currentTab()).toBe(expected);
  });

  // DRIFT build-check 4, as a test rather than a comment. No click, no
  // handler, no state: the route changes underneath and the selection follows.
  // A `useState`-backed tab bar passes every assertion above and fails here.
  it("follows the route with no interaction (DRIFT build-check 4)", () => {
    const { rerender } = renderAt("/trips/t1?lens=Map");
    expect(currentTab()).toBe("Map");

    // `rerender`, deliberately not a second `render`: the bar is mounted once
    // in `(app)/layout.tsx` and stays mounted across every navigation under
    // it, so a fresh mount is the one thing that never happens in production —
    // and it is exactly what would let a `useState` initialiser look correct
    // here while desyncing in the app.
    url = "/";
    rerender(<PhoneTabBar />);
    expect(currentTab()).toBe("Trips");
  });

  // SPEC §10: a bare `/trips/<id>` resolves to the Board lens, which the phone
  // must never show. Plan therefore names the lens it wants.
  // No @testing-library/jest-dom in this repo (AccountMenu.test.tsx:151 and
  // SettingsSheet.test.tsx:187 say the same) — read the DOM property.
  const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

  it("points Plan at Timeline, Map at the map lens, and Notebook at the pages route", () => {
    renderAt("/trips/t1");
    expect(hrefOf("Plan")).toBe("/trips/t1?lens=Schedule&view=Timeline");
    expect(hrefOf("Map")).toBe("/trips/t1?lens=Map");
    expect(hrefOf("Notebook")).toBe("/trips/t1/pages");
  });

  // The other half of §22, and its accepted cost: from inside a trip the
  // account pair is NOT in the bar, so Playbooks is two taps via the header's
  // `‹ Trips`. Asserted because it is a deliberate trade the spec names, not an
  // oversight for a later change to quietly "fix" by re-adding a fifth tab.
  it("does not carry Trips or Playbooks from inside a trip", () => {
    renderAt("/trips/t1?lens=Map");
    expect(screen.queryByRole("link", { name: "Trips" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Playbooks" })).toBeNull();
  });

  // This replaces a test that asserted the trip three were rendered DISABLED
  // outside a trip. §22 removed that state outright: "a disabled control is UI
  // with no purpose on the page (RULES.md rule 2) and it lies about why it is
  // off." So the assertion is now absence — and specifically absence of any
  // control, not just of a link, because a disabled `<button>` is exactly what
  // this used to render and exactly what must not come back.
  it("renders no control at all for the trip views outside a trip", () => {
    renderAt("/playbooks");

    for (const label of ["Plan", "Map", "Notebook"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
      expect(screen.queryByRole("button", { name: new RegExp(`^${label}`) })).toBeNull();
    }
    expect(hrefOf("Trips")).toBe("/");
    expect(hrefOf("Playbooks")).toBe("/playbooks");
  });

  // §22's active affordance: "shape carries the signal, colour confirms it."
  // The pill is on the glyph's own box, so the label sits outside it.
  it("marks the active tab with a filled pill behind its glyph, and only that one", () => {
    renderAt("/trips/t1?lens=Map");
    const pills = screen.getAllByTestId("phone-tab-pill");
    expect(pills).toHaveLength(3);
    const filled = pills.filter((el) => el.className.includes("bg-brand-tint"));
    expect(filled).toHaveLength(1);
    // The active link is the one whose name matches; asserting through the
    // accessible name rather than walking up the DOM keeps this off the
    // lint wall's `no-node-access` list.
    expect(screen.getByRole("link", { name: "Map" }).getAttribute("aria-current")).toBe("page");
  });
});
