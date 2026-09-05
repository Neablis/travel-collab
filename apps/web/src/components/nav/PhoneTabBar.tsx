"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BookOpen, List, Luggage, Map, NotebookText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// Handoff `Trip Planner Redesign.dc.html:863-871` (markup) and `:7211-7229`
// (the active-state logic). The phone's five-tab bottom bar, and — per SPEC
// §13 "The tab bar is the router" — the *only* phone navigation between the
// trip list, a trip's three views, and Playbooks.
//
// SPEC §16 supersedes §13's four-tab list: Plan / Map / Notebook / Playbooks /
// Trips.
//
// ─── The one rule this file exists to keep ───────────────────────────────────
// SPEC §13: "'Trips' is **not** a storable tab value — the route alone says
// whether the list is showing, so no handler can desync them. The phone must
// never hold tab state that can disagree with the route." DRIFT.md build-check
// 4 says the same thing as a build check. So this component holds **no state**:
// every tab's selected-ness is derived from `usePathname()` + `?lens=`, exactly
// as `LensRouter` derives the lens itself, and every tab is a `<Link>` — a real
// navigation, not a handler that sets a value some other handler could unset.
//
// ─── Deliberate, flagged deviation: icons ────────────────────────────────────
// The design file draws the glyphs as literal text characters
// (▤ ◎ ✎ ❖ ☰, `:7212-7216`). This build uses `lucide-react` instead, for two
// reasons: (a) lucide is already this app's icon vocabulary (17 files import
// it, `NotebookText` among them — the same icon the notebook surfaces use, so
// the tab and the thing it opens now agree); (b) those five characters have
// very poor cross-platform metrics — ❖ and ▤ fall back to different fonts on
// iOS, Android and desktop Chrome, at different optical weights and baselines,
// which is exactly the wobble a 16px glyph above an 11px label cannot absorb.
// The mapping is semantic rather than shape-for-shape: Plan is the day's list,
// Trips is the luggage. Names verified against the installed lucide-react
// 1.24.0.
const TABS = [
  { id: "plan", label: "Plan", Icon: List },
  { id: "map", label: "Map", Icon: Map },
  { id: "notebook", label: "Notebook", Icon: NotebookText },
  { id: "playbooks", label: "Playbooks", Icon: BookOpen },
  { id: "trips", label: "Trips", Icon: Luggage },
] as const;

type PhoneTabId = (typeof TABS)[number]["id"];

/**
 * The trip id in the path, or `null` outside a trip. `/trips/<id>` and
 * anything under it (`/pages`, `/pages/<pageId>`).
 */
function tripIdFromPathname(pathname: string): string | null {
  return /^\/trips\/([^/]+)(?:\/|$)/.exec(pathname)?.[1] ?? null;
}

/**
 * Which tab the current route selects — `null` when none does.
 *
 * This is the design file's own `:7218-7220` predicate, transcribed onto this
 * app's routes, and its shape is deliberate: the design's comment at `:7205`
 * reads "Trips must not fall through to 'anything that isn't a trip'", so
 * every arm names the routes it owns and an unlisted route (`/invite/<token>`)
 * selects nothing rather than lighting a tab it has no relationship to.
 *
 * The two non-obvious rows are the design's, not an invention here:
 * `/playbooks/board` (the "Who shares the most" leaderboard — the design's
 * `route: 'board'`, `:7330`) and `/playbooks/profile/<userId>` (its
 * `route: 'profile'`) select **Trips**, not Playbooks. Only Discover itself
 * (`/playbooks`) and a shared day (`/playbooks/day/<id>`) select Playbooks.
 * See the note in this component's report: the two are nested under
 * `/playbooks` in this app for a routing reason (`proxy.ts`'s
 * `/playbooks/:path*` matcher), which is not the same as being Playbooks in
 * the design's sense.
 *
 * `lens` is the raw `?lens=` string rather than a `Lens`, because this
 * component sits in `(app)/layout.tsx` — *above* `LensRouter`, which is
 * mounted inside the trip page — so `useLens()` is not available here. The
 * derivation is the same one and there is still no second source of truth:
 * "Map" and "not Map" is the whole of it, and LensRouter's own fallback
 * ("anything unrecognised is Board") lands an unknown value on Plan, which is
 * where Board lives on a phone.
 */
function activePhoneTab(pathname: string, lens: string | null): PhoneTabId | null {
  if (tripIdFromPathname(pathname)) {
    if (/^\/trips\/[^/]+\/pages(?:\/|$)/.test(pathname)) return "notebook";
    return lens === "Map" ? "map" : "plan";
  }
  if (pathname === "/") return "trips";
  if (pathname === "/playbooks/board" || pathname.startsWith("/playbooks/profile/")) return "trips";
  if (pathname === "/playbooks" || pathname.startsWith("/playbooks/day/")) return "playbooks";
  return null;
}

/**
 * Where each tab goes. `null` means "this tab has nowhere to go from here" —
 * the three trip tabs outside a trip, which render disabled rather than
 * guessing a trip. SPEC §13 names the failure that guessing produces: "a Plan
 * screen outside a trip has no focused day and renders an empty itinerary
 * under a header that still counts stops." Remembering the last trip would be
 * exactly the tab state that can disagree with the route which §13 forbids.
 */
function phoneTabHref(tab: PhoneTabId, tripId: string | null): string | null {
  switch (tab) {
    case "trips":
      return "/";
    case "playbooks":
      return "/playbooks";
    case "plan":
      // Not a bare `/trips/<id>`: that URL resolves to the *Board* lens
      // (LensRouter's default), and SPEC §10 keeps Day columns off the phone.
      return tripId ? `/trips/${tripId}?lens=Schedule&view=Timeline` : null;
    case "map":
      return tripId ? `/trips/${tripId}?lens=Map` : null;
    case "notebook":
      return tripId ? `/trips/${tripId}/pages` : null;
  }
}

const TAB_CLASS =
  "flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-2xs leading-none no-underline";

/**
 * The bar itself, taking the route as plain values so it can be rendered from
 * both the server-safe path and the `useSearchParams()` one below.
 */
function PhoneTabBarView({ pathname, lens }: { pathname: string; lens: string | null }) {
  const barRef = useRef<HTMLElement>(null);

  const tripId = tripIdFromPathname(pathname);
  const active = activePhoneTab(pathname, lens);

  // The bar is `position: fixed`, so it reserves no space in normal flow and a
  // page's last row ends up underneath it. This is the same problem — and the
  // same remedy — as the fixed unscheduled rack: publish the measured height
  // as a custom property and let a CSS rule (`.phone-tab-bar-inset`,
  // globals.css) pad by it, exactly as `.trip-board-content` pads by
  // `--rack-height` (TripBoardScreen.tsx). Measured rather than hard-coded for
  // the reason that pattern is measured: the number is a rendered height (a
  // wrapped label, a larger OS text size, the iOS home indicator) and a
  // constant here would be a second copy of it that silently drifts.
  //
  // Published on `document.documentElement` rather than on an ancestor div,
  // because the content this reserves against is the bar's *sibling* — the
  // layout's `children` — and there is no element between them to hang it on.
  // `getBoundingClientRect()` on a `display: none` element is 0, which is
  // precisely the value wanted at >=768px where `md:hidden` hides the bar; the
  // `resize` listener is what guarantees a re-read when that breakpoint is
  // crossed, so nothing here depends on ResizeObserver's behaviour for an
  // element that has stopped being rendered.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty("--phone-tab-bar-height", `${el.getBoundingClientRect().height}px`);
    sync();
    // Feature-detected: jsdom does not ship ResizeObserver, the same guard
    // `useIsPhone` uses for `matchMedia`.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
    observer?.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
      root.style.removeProperty("--phone-tab-bar-height");
    };
  }, []);

  return (
    // `md:hidden`, not `useIsPhone()`: that hook starts `false` on the server
    // and on the first client paint by design (see its comment), so a
    // JS-gated bar would be absent for one paint and then pop in — the same
    // reason `AssistantBubble.tsx:38` uses a CSS breakpoint. Nothing here
    // needs the JS answer: no measurement machinery runs at >=768px, because
    // a `display: none` subtree has no layout to observe.
    <nav
      ref={barRef}
      aria-label="Phone navigation"
      // `z-20`, NOT `z-30`. `.assistant-rail` (globals.css) is a `position:
      // fixed; inset: 0` full-screen takeover at `z-index: 30` below 768px,
      // and its own comment records why that number: "z-index: 30 here clears
      // both stacking competitors already on this page — TripHeader's 10 and
      // `.unscheduled-rack`'s 20 — so nothing can paint over the rail again."
      // A bar at `z-30` ties that and wins on DOM order (it is mounted after
      // `children` in the layout), so it painted over the open assistant and
      // covered the bottom 83px — the composer and Ask. That is Mitchell's own
      // "the input is unselectable" bug re-made, and `m16-mobile-assistant`
      // caught it. 20 puts the bar in the rack's tier: above page content,
      // under the takeover that is meant to cover everything.
      className="phone-tab-bar fixed inset-x-0 bottom-0 z-20 flex border-t border-hairline bg-surface pt-2 md:hidden"
    >
      {TABS.map(({ id, label, Icon }) => {
        const href = phoneTabHref(id, tripId);
        const isActive = active === id;
        const tone = isActive ? "font-semibold text-brand" : "font-normal text-slate";
        const icon = <Icon aria-hidden className="size-4" />;

        // No trip in the route ⇒ no destination. A disabled control, not a
        // hidden one: the bar's five positions stay put between routes, which
        // is the whole point of a tab bar.
        if (href === null) {
          return (
            <Button
              key={id}
              variant="ghost"
              disabled
              aria-label={`${label} — open a trip first`}
              className={cn(TAB_CLASS, "h-auto px-0 hover:bg-surface", tone)}
            >
              {icon}
              {label}
            </Button>
          );
        }

        return (
          <Link
            key={id}
            href={href}
            // `scroll: false` for LensRouter's reason (see its `write`
            // comment): the lens owns where the page sits after a view
            // change, and Next's default scroll-to-top lands *after* the
            // newly-mounted lens has scrolled itself to the selected day.
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(TAB_CLASS, tone)}
          >
            {icon}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * What the server renders, and the Suspense fallback in `(app)/layout.tsx`.
 *
 * `useSearchParams()` opts its subtree out of static rendering, and Next
 * satisfies that by rendering the *fallback* on the server and the component
 * itself on the client. With `fallback={null}` that meant the whole bar was
 * absent from first-paint HTML while `.phone-tab-bar-inset` was already
 * reserving its height — a phone would show an 83px gap with no navigation in
 * it until hydration, which is worse than the pop-in `md:hidden` was chosen to
 * avoid. Copilot caught it on PR #143.
 *
 * `usePathname()` triggers no such bailout, and the route alone settles four
 * of the five tabs. The one thing it cannot know is Plan-vs-Map inside a trip,
 * so it renders `lens: null` — which `activePhoneTab` reads as Plan, the right
 * guess: a bare `/trips/<id>` is normalised to Timeline (SPEC §10), so Plan is
 * where a trip route without an explicit lens actually lands. A reader who
 * deep-links `?lens=Map` sees Plan lit for one paint and Map thereafter; the
 * bar's position, size and hit targets never move.
 */
export function PhoneTabBarFallback() {
  return <PhoneTabBarView pathname={usePathname()} lens={null} />;
}

export function PhoneTabBar() {
  return <PhoneTabBarView pathname={usePathname()} lens={useSearchParams().get("lens")} />;
}
