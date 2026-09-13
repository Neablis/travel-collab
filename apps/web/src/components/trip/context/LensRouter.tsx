"use client";
import { createContext, useContext, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
export const VIEWS = ["Overview", "Plan", "Calendar", "Map"] as const;
export type View = (typeof VIEWS)[number];

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
 *   anything else, or nothing   -> Overview
 *
 * **The default moved from Board to Overview** and that is §24's: *"Entering a
 * trip lands on Overview. You read a trip before you change it."*
 */
export function resolveView(params: { get: (k: string) => string | null }): View {
  const raw = params.get("view");
  if ((VIEWS as readonly string[]).includes(raw ?? "")) return raw as View;

  const lens = params.get("lens");
  if (lens === "Map") return "Map";
  if (lens === "Board") return "Plan";
  if (lens === "Schedule") return raw === "Calendar" ? "Calendar" : "Plan";
  if (raw === "Calendar") return "Calendar";
  if (raw === "Timeline") return "Plan";
  return "Overview";
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
  const router = useRouter();
  const pathname = usePathname();

  const value = useMemo<LensCtx>(() => {
    const view = resolveView(params);
    // `scroll: false` is load-bearing for the day-sync contract's clause 3
    // ("changing the tab jumps to the selected day" — see `FocusProvider`'s
    // header), not just a nicety: Next's default scrolls the window to the top
    // on a navigation, and it would land AFTER the newly-mounted view has
    // scrolled itself to the selected day, undoing it. The view owns where the
    // page sits after a tab change; the router leaves it alone.
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
        router.replace(`${pathname}?${n.toString()}`, { scroll: false });
      }, // one direction: click -> URL -> derive
    };
  }, [params, router, pathname]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
