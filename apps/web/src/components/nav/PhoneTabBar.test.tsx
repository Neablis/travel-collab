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
  it("shows the five tabs SPEC §16 names, in order", () => {
    // Inside a trip every tab is live, so DOM order and query order agree.
    renderAt("/trips/t1");
    expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual([
      "Plan",
      "Map",
      "Notebook",
      "Playbooks",
      "Trips",
    ]);
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

  it("keeps Trips and Playbooks reachable from inside a trip", () => {
    renderAt("/trips/t1?lens=Map");
    expect(hrefOf("Trips")).toBe("/");
    expect(hrefOf("Playbooks")).toBe("/playbooks");
  });

  // SPEC §13: "a Plan screen outside a trip has no focused day and renders an
  // empty itinerary under a header that still counts stops." Outside a trip
  // the three trip tabs have nowhere to go, and remembering the last trip
  // would be exactly the tab state §13 forbids — so they are dead, not
  // guessing.
  it("disables Plan, Map and Notebook outside a trip", () => {
    renderAt("/playbooks");

    for (const label of ["Plan", "Map", "Notebook"]) {
      const tab = screen.getByRole("button", { name: new RegExp(`^${label} `) });
      expect((tab as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    // …and the two that are account scope stay live.
    expect(hrefOf("Trips")).toBe("/");
    expect(hrefOf("Playbooks")).toBe("/playbooks");
  });
});
