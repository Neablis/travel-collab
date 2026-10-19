"use client";
import { createContext, useContext, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { TRIP_VIEWS, type TripView } from "@tc/contracts";
import { isDemoBoardPath } from "@/lib/demoTrip";

// SPEC §24: the trip has **four peer views — Overview · Plan · Calendar · Map**
// — and the change is not cosmetic. Each one answers one question, and the
// SCOPE of each one is the design:
//
//   | View     | Question                                    | Scope |
//   |----------|---------------------------------------------|-------|
//   | Overview | What is this trip, what needs me, who's in   | Trip. Read only — nothing on it edits |
//   | Plan     | Build it: move days, add stops, park ideas   | Day. The only surface that edits |
//   | Calendar | What shape is this trip against real dates   | Trip. Deliberately does not drop into a day |
//   | Map      | Where does it sit; am I moving too much      | Day. Reads one day's movement |
//
// **Timeline is deleted, not hidden** (§24). Its read-only day list becomes a
// widget inside the Overview document, and its editing behaviours were always
// Day columns' job. "Day columns" is called **Plan** now, on both surfaces —
// the phone tab bar already said Plan while the desktop said Day columns.
//
// **Calendar and Map had their scopes backwards and are swapped.** Calendar
// used to keep day focus and Map used to clear it; the opposite is correct.
// `dayScopeFor` below is the whole of that rule, and §24 states it directly:
// day scope is Plan and Map, and nothing else.
//
// ONE PARAM, not two. This used to be `?lens=Board|Map|Schedule` crossed with
// `?view=Timeline|Calendar`, which could express states no tab could reach
// (`lens=Map&view=Calendar`) and needed `setLensAndView` to write both at once
// without losing an update. Four peer views need one value.
//
// The list is the contract's (ADR-072 §3): the assistant names a view by it,
// so the page and the allowlist cannot hold two.
export const VIEWS = TRIP_VIEWS;
export type View = TripView;

/**
 * Whether this view acts on a single day — §24's `dayScope`.
 *
 * Exported as a function rather than read off the context so the non-React
 * callers (and tests) that need the rule do not have to mount a provider to
 * ask a question about a string.
 */
export function dayScopeFor(view: View): boolean {
  return view === "Plan" || view === "Map";
}

/**
 * Resolve the view from the URL, including every shape the URL had before §24.
 *
 * A share link, a bookmark and an e2e spec all carry the old two-param form,
 * and `m10-growth.spec.ts` opens `?lens=Board` deliberately (it wants ten
 * columns overflowing at 411px, and the width is only how it gets there). None
 * of them may 404 into a default, so the old vocabulary is mapped rather than
 * dropped:
 *
 *   lens=Board                  -> Plan     (Day columns, renamed)
 *   lens=Schedule&view=Timeline -> Plan     (Timeline's editing behaviours were Plan's)
 *   lens=Schedule&view=Calendar -> Calendar
 *   lens=Map                    -> Map
 *   view=Timeline               -> Plan
 *   view=Calendar               -> Calendar
 *   page=… with no view         -> Overview (a notebook link card is Overview's)
 *   anything else, or nothing   -> `landing`, which `landingView` answers
 *
 * **The default moved from Board to Overview** and that is §24's: *"Entering a
 * trip lands on Overview. You read a trip before you change it."*
 */
export function resolveView(params: { get: (k: string) => string | null }, landing: View = "Overview"): View {
  const raw = params.get("view");
  if ((VIEWS as readonly string[]).includes(raw ?? "")) return raw as View;

  const lens = params.get("lens");
  if (lens === "Map") return "Map";
  if (lens === "Board") return "Plan";
  if (lens === "Schedule") return raw === "Calendar" ? "Calendar" : "Plan";
  if (raw === "Calendar") return "Calendar";
  if (raw === "Timeline") return "Plan";
  return params.get("page") !== null ? "Overview" : landing;
}

/**
 * The view a trip opens on when its URL names none. Overview (§24), except on
 * a demo: a visitor is there to see the planning, and Plan is the surface that
 * shows it (Mitchell, 2026-10-11). Read off the path so the board and the
 * phone tab bar cannot disagree about which view is open.
 */
export function landingView(pathname: string): View {
  return isDemoBoardPath(pathname) ? "Plan" : "Overview";
}

type LensCtx = {
  view: View;
  /** §24's `dayScope` for the current view. */
  dayScope: boolean;
  setView: (v: View) => void;
};
const Ctx = createContext<LensCtx | null>(null);
export const useLens = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLens outside LensRouter");
  return v;
};

export function LensRouter({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();

  const value = useMemo<LensCtx>(() => {
    const view = resolveView(params, landingView(pathname));
    // **A tab change is not a navigation** (PR 486 review). It used to be
    // `router.replace(url, { scroll: false })`, and on this dynamic page a
    // router navigation, even one that changes only the query, fetches the
    // page from the server again: since the trip page reads its first data
    // there, that re-ran every read for an answer the provider throws away,
    // and the old tab stayed up until it came back. `history.replaceState`
    // asks the server nothing, and Next (>= 14.1; its `app-router` patches
    // the method) moves `useSearchParams` and `usePathname` with it.
    //
    // **`null` for the state, never `window.history.state`.** Next's patch
    // treats a state carrying its own keys (`__NA`) as its own call and skips
    // the sync, so the view would never change. It copies those keys over itself.
    //
    // It does not scroll, which keeps the day-sync contract's clause 3
    // ("changing the tab jumps to the selected day" — see `FocusProvider`'s
    // header): the newly-mounted view scrolls itself to the selected day, and
    // nothing scrolls the window to the top after it. The view owns where the
    // page sits after a tab change.
    return {
      view,
      dayScope: dayScopeFor(view),
      setView: (v) => {
        const n = new URLSearchParams(params);
        n.set("view", v);
        // The legacy param goes on the way out, or it would keep out-voting
        // the new one for the rest of the session: `resolveView` reads `view`
        // first, but a stale `lens=Map` left in the query string is a URL that
        // says two different things, and the next reader of it (a share, a
        // copied link) gets whichever rule they apply first.
        n.delete("lens");
        // A notebook followed from a link card (`?page=`, `OverviewLens`) is
        // the Overview tab's; picking a tab — Overview included — leaves it.
        n.delete("page");
        window.history.replaceState(null, "", `${pathname}?${n.toString()}`);
      }, // one direction: click -> URL -> derive
    };
  }, [params, pathname]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
