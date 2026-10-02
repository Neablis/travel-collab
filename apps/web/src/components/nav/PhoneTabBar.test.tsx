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

// Who is reading, as `useSessionUser` reports it. `undefined` (not known yet)
// unless a test says otherwise — the state every test above the signed-out
// block was written against, and the one in which the bar draws as it always has.
let session: { id: string } | null | undefined = undefined;
vi.mock("@/components/account/useSessionUser", () => ({ useSessionUser: () => session }));

import { PhoneTabBar, PhoneTabBarFallback } from "./PhoneTabBar";

afterEach(() => {
  cleanup();
  session = undefined;
});

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
  // Overview joined the trip set on 2026-10-01 (Mitchell): without it a phone
  // that tapped Plan or Map had no way back to the view a trip lands on.
  it("shows the trip's views inside a trip, in order", () => {
    renderAt("/trips/t1");
    expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual([
      "Overview",
      "Plan",
      "Map",
      "Notebook",
    ]);
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
    // A bare trip URL renders Overview (§24), so Overview is what it lights.
    ["/trips/t1", "Overview"],
    ["/trips/t1?lens=Schedule&view=Timeline", "Plan"],
    ["/trips/t1?lens=Board", "Plan"],
    ["/trips/t1?lens=Map", "Map"],
    // **The parameter this bar's own links actually write**, and the one the
    // active-tab check did not read: SPEC §24 moved every trip link to `?view=`
    // and this line kept reading `?lens=`, so tapping Map navigated to Map and
    // left Plan lit (CodeRabbit, PR 170). The `lens=` rows above stay — a
    // bookmark still carries them — and now both vocabularies light the same
    // tab the URL resolves to.
    ["/trips/t1?view=Map", "Map"],
    ["/trips/t1?view=Plan", "Plan"],
    // Calendar has no tab of its own, so it lights nothing. It used to light
    // Plan, which marked a tab current whose link leads to a different screen
    // than the one showing (KI-2026-09-24-l). Overview was in the same row
    // until it got a tab of its own (Mitchell, 2026-10-01).
    ["/trips/t1?view=Overview", "Overview"],
    ["/trips/t1?view=Calendar", null],
    ["/trips/t1/pages", "Notebook"],
    ["/trips/t1/pages/p1", "Notebook"],
    ["/invite/tok", null],
  ])("selects %s → %s", (at, expected) => {
    renderAt(at);
    expect(currentTab()).toBe(expected);
  });

  // KI-2026-09-24-l, the invariant: `aria-current="page"` is on the tab of the
  // view that is ON SCREEN, or on none. A bare trip URL renders Overview
  // (SPEC §24, "Entering a trip lands on Overview"), so Overview is current —
  // not Plan, which this bar used to light there while tapping it navigated
  // AWAY to `?view=Plan`.
  it("marks Overview current when a trip opens on Overview", () => {
    renderAt("/trips/t1");
    expect(currentTab()).toBe("Overview");
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

  // A bare `/trips/<id>` resolves to **Overview** since SPEC §24, which is
  // read-only — so Plan still has to name the view it wants, for a new reason.
  // (It used to name Timeline, because §10 kept day columns off the phone;
  // §24 deleted Timeline and Plan IS day columns now. See `PhoneTabBar.tsx`.)
  // No @testing-library/jest-dom in this repo (AccountMenu.test.tsx:151 and
  // SettingsSheet.test.tsx:187 say the same) — read the DOM property.
  const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

  it("points Overview, Plan and Map at their views, and Notebook at the pages route", () => {
    renderAt("/trips/t1");
    expect(hrefOf("Overview")).toBe("/trips/t1?view=Overview");
    expect(hrefOf("Plan")).toBe("/trips/t1?view=Plan");
    expect(hrefOf("Map")).toBe("/trips/t1?view=Map");
    expect(hrefOf("Notebook")).toBe("/trips/t1/pages");
  });

  // The Plan tab must never point at a read-only view: it exists to reach the
  // one surface that edits (§24). A bare `/trips/<id>` would now land on
  // Overview, which is the regression this pins.
  it("never points Plan at a bare trip URL, which would land on read-only Overview", () => {
    renderAt("/trips/t1");
    expect(hrefOf("Plan")).not.toBe("/trips/t1");
    expect(hrefOf("Plan")).toContain("view=Plan");
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
  // The SSR-safe fallback is what `(app)/layout.tsx` renders on the server,
  // and it is the fix for a first-paint regression where the bar was absent
  // from server HTML entirely while its height was already reserved. Every
  // other test here renders `PhoneTabBar`, so `PhoneTabBarFallback` could go
  // back to returning `null` and they would all stay green — which is exactly
  // how the regression got in. (Copilot, PR #143.)
  // **A task owns the whole screen, so the bar steps aside** (SPEC §34.3:
  // *"because it is a task rather than a view the tab bar steps aside for it…
  // Done returns you to Trips"*). M26 Wave 2, link 11.
  describe("when a task owns the screen", () => {
    it.each(["/account", "/plans"])("renders no bar at all on %s", (route) => {
      renderAt(route);
      expect(tabs()).toEqual([]);
      expect(screen.queryByRole("navigation", { name: "Phone navigation" })).toBeNull();
    });

    // **Not the same thing as lighting no tab**, which is the ordinary case for
    // anything the bar does not own. An invite is a view of a thing; an account
    // is a job you finish and leave.
    it("still renders a bar on a route that merely lights no tab", () => {
      renderAt("/invite/abc123");
      expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual(["Trips", "Playbooks"]);
      expect(currentTab()).toBeNull();
    });

    // The bar publishes its height on `documentElement` and the layout's inset
    // reserves that much space. A stale value would reserve 83px at the foot of
    // a screen with no bar in it — the inset is the bar's SIBLING and cannot see
    // that it is gone. This is why the height effect runs on a task route too
    // rather than being skipped with the render.
    it("unpublishes the height it reserved when it steps aside", () => {
      const { unmount } = renderAt("/");
      unmount();
      renderAt("/account");
      expect(document.documentElement.style.getPropertyValue("--phone-tab-bar-height")).toBe("");
    });
  });

  // ADR-061: the playbooks are readable without an account, and outside a trip
  // this bar is Trips (theirs, of which they have none) and Playbooks (where
  // they already are). The header's *Sign in* is their way in.
  describe("for a reader with no account", () => {
    it.each(["/playbooks", "/playbooks/day/d1", "/playbooks/board", "/"])("renders no bar on %s", (route) => {
      session = null;
      renderAt(route);
      expect(tabs()).toEqual([]);
      expect(screen.queryByRole("navigation", { name: "Phone navigation" })).toBeNull();
    });

    // The bar was drawn while the session was still unknown and published its
    // height; `.phone-tab-bar-inset` would keep that 83px under nothing.
    it("unpublishes its height once the session says signed out", () => {
      const { rerender } = renderAt("/playbooks");
      expect(document.documentElement.style.getPropertyValue("--phone-tab-bar-height")).not.toBe("");
      session = null;
      rerender(<PhoneTabBar />);
      expect(tabs()).toEqual([]);
      expect(document.documentElement.style.getPropertyValue("--phone-tab-bar-height")).toBe("");
    });

    // The demo is a signed-out visitor's trip, and below 768px this bar is the
    // only way between its views.
    it("still renders the demo's views", () => {
      session = null;
      renderAt("/demo");
      expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual(["Overview", "Plan", "Map"]);
    });

    // Hidden on a confirmed `null` only: a signed-in reader must not see the
    // bar missing for the length of the session read.
    it("renders as always while the session is not known yet", () => {
      session = undefined;
      renderAt("/playbooks");
      expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual(["Trips", "Playbooks"]);
    });
  });

  describe("PhoneTabBarFallback (what the server renders)", () => {
    it("renders the trip's scoped set from the pathname alone, and marks no trip tab it cannot know", () => {
      // `?view=Plan` in the URL on purpose: the fallback cannot read the query,
      // so even when Plan IS the view, it must not claim it. Guessing Plan is
      // what lit it over Overview on a bare trip URL (KI-2026-09-24-l).
      url = "/trips/t1?view=Plan";
      render(<PhoneTabBarFallback />);

      expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual([
        "Overview",
        "Plan",
        "Map",
        "Notebook",
      ]);
      expect(currentTab()).toBeNull();
    });

    it("renders the account pair outside a trip", () => {
      url = "/playbooks";
      render(<PhoneTabBarFallback />);

      expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual(["Trips", "Playbooks"]);
      expect(screen.getByRole("link", { name: "Playbooks" }).getAttribute("aria-current")).toBe("page");
    });
  });

  // **`/demo` is a trip too** (ADR-031), just not one under `/trips/<id>`, so a
  // bar that only recognised that shape gave a phone visitor no way to reach
  // Plan or Map: the board hides its own view strip below 768px because this
  // bar is supposed to carry them (Mitchell, 2026-10-01, option B).
  describe("on the demo trip", () => {
    // As a whole list, for the reason the scope tests above give: what matters
    // is what is ABSENT. Notebook goes to `/trips/<id>/pages` and Trips and
    // Playbooks to signed-in surfaces — every one of them a sign-in wall for a
    // visitor with no account, which is a tab that leaves the demo.
    it("shows only the views the demo itself serves, linked to the demo", () => {
      renderAt("/demo");
      expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual(["Overview", "Plan", "Map"]);
      expect(hrefOf("Overview")).toBe("/demo?view=Overview");
      expect(hrefOf("Plan")).toBe("/demo?view=Plan");
      expect(hrefOf("Map")).toBe("/demo?view=Map");
    });

    it.each([
      ["/demo", "Overview"],
      ["/demo?view=Overview", "Overview"],
      ["/demo?view=Calendar", null],
      ["/demo?view=Plan", "Plan"],
      ["/demo?view=Map", "Map"],
      ["/demo?lens=Map", "Map"],
    ])("selects %s → %s", (at, expected) => {
      renderAt(at);
      expect(currentTab()).toBe(expected);
    });

    it("renders the same set from the server-safe fallback, lighting nothing", () => {
      url = "/demo?view=Map";
      render(<PhoneTabBarFallback />);
      expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual(["Overview", "Plan", "Map"]);
      expect(currentTab()).toBeNull();
    });
  });

  it("renders no control at all for the trip views outside a trip", () => {
    renderAt("/playbooks");

    for (const label of ["Overview", "Plan", "Map", "Notebook"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
      expect(screen.queryByRole("button", { name: new RegExp(`^${label}`) })).toBeNull();
    }
    expect(hrefOf("Trips")).toBe("/");
    expect(hrefOf("Playbooks")).toBe("/playbooks");
  });

});
