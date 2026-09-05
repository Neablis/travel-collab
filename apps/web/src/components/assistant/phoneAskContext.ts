import type { TripDetail } from "@tc/contracts";
import { chipModel } from "@/components/trip/DayChips";
import type { AskScope } from "@/lib/apiClient";
import { suggestedQuestions } from "./suggestedQuestions";

/**
 * The phone surface the Ask pill was tapped on.
 *
 * SPEC §23 makes the sheet's scope a function of exactly this — "which phone
 * tab, and is a page open" — because the pill is deliberately NOT a fourth tab.
 * A tab is a destination and a destination has to invent its own scope, which
 * on a screen showing one day at a time means opening on the whole trip and
 * losing the day or the page you were reading. Anything that opens the sheet
 * with a trip-wide default has reimplemented the thing the design rejected
 * (DRIFT §2i).
 */
export type PhoneAskSurface =
  | { tab: "plan" | "map" }
  // Both Notebook screens are the same tab; `page` is what separates the index
  // from an open page, and it is the only thing that does.
  | { tab: "notebook"; page: PhoneAskPage | null };

export type PhoneAskPage = {
  pageId: string;
  title: string;
  /**
   * How many widgets on this page have an input still unbound — what §21 calls
   * "not set up".
   *
   * **`null` means the caller cannot tell, and is not the same as zero.** It
   * gates "What is not set up?", and offering that ask on a page with nothing
   * outstanding is a question whose honest answer is "there isn't one" — the
   * failure `suggestedQuestions` exists to prevent, and the reason M16 Wave 2
   * deleted `PREVIEW_QUICK_ASKS`. So an unknown count withholds the ask rather
   * than guessing it, and the ask stays off until a caller can prove the
   * condition. Nothing computes this count yet: it needs each `MacroNode` in
   * the page resolved through `@tc/pages` (`MacroResult.status === "unbound"`),
   * which `MacroView` does per widget and never totals.
   */
  unsetUpWidgets: number | null;
};

/** Everything the phone Ask sheet derives from its surface. */
export type PhoneAskContext = {
  /** What goes on the wire. Never widened past what the surface is showing. */
  scope: AskScope;
  /** The sheet's first line. Scope is stated, never inferred by the user (§23). */
  contextLine: string;
  /** The sheet's copy before there is a turn or a proposal in it. */
  emptyHint: string;
  quickAsks: string[];
  // **There is deliberately no `placeholder`, and adding one is the
  // regression.** §23 and the design file specify a composer placeholder keyed
  // off the TAB — "Ask about this page…" on both Notebook screens, "Ask about
  // this day…" on Plan and Map. `AssistantRail` keys its own off the SCOPE,
  // and in all three cases where the two disagree the rail is the honest one:
  //
  // | Surface                   | scope  | rail                          | §23                    |
  // |---------------------------|--------|-------------------------------|------------------------|
  // | Plan/Map, no focused day  | `trip` | "Ask about this trip…"        | "Ask about this day…"  |
  // | Notebook index            | `trip` | "Ask about this trip…"        | "Ask about this page…" |
  // | An open page              | `page` | "Ask AI to add to this page…" | "Ask about this page…" |
  //
  // Every row is a box contradicting the context line two elements above it,
  // and the last one also hides that an answer there lands in the document
  // rather than in the transcript. That is finding 3 of the 2026-08-29 branch
  // review, which the rail already fixed; wiring §23's placeholder would
  // reintroduce it on the phone. Guarded rather than merely asserted here:
  // `NotebookScreen.test.tsx` types into `/Ask about this trip/`,
  // `PageAssistant.test.tsx` into `/add to this page/`, and
  // `TripBoardScreen.test.tsx` pins the trip↔day swap as focus changes.
};

// Copy is design-supplied (§23 and `Trip Planner Redesign.dc.html`'s
// `phoneAskHint`), not written here. Both hints key off the TAB alone — the
// Notebook index and an open page share one, exactly as the design file does.
const PAGE_HINT = "It reads the page you have open, its widgets and what they are pointed at.";
const DAY_HINT =
  "It reads the day you have open — the stops, their times, what is booked and what is not. " +
  "Ask it to move something and you get a proposal to keep or discard.";

/**
 * The phone Ask sheet's scope, and the three pieces of copy that derive from it.
 *
 * Pure — `(TripDetail, focusedDay, surface) => PhoneAskContext`, no hooks, no
 * clock, no fetch — the same shape and for the same reason as
 * `suggestedQuestions`: the rules are the design decision, so they are testable
 * without a render.
 *
 * `focusedDay` is the 0-BASED index `FocusProvider` holds, matching `AskScope`.
 * An index left over from a day that has since been removed reads as no focus
 * at all — the wider and safer reading, the same call `parseAskScope` makes
 * server-side and the same one `suggestedQuestions` makes for its questions, so
 * a stale index can never produce a `day` scope pointing at nothing.
 */
export function phoneAskContext(
  trip: TripDetail,
  focusedDay: number | null,
  surface: PhoneAskSurface,
): PhoneAskContext {
  if (surface.tab === "notebook") {
    const { page } = surface;
    return {
      scope: page === null ? { kind: "trip" } : { kind: "page", pageId: page.pageId },
      contextLine: page === null ? "Asking about this trip’s Notebook" : `Asking about “${page.title}”`,
      emptyHint: PAGE_HINT,
      quickAsks: notebookQuickAsks(page),
    };
  }

  // `trip.days[focusedDay]` is `undefined` for a negative or out-of-range
  // index, which is what makes the stale-index case fall through to trip scope.
  const day = focusedDay === null ? undefined : trip.days[focusedDay];
  const onADay = day !== undefined && focusedDay !== null;

  return {
    scope: onADay ? { kind: "day", dayIndex: focusedDay } : { kind: "trip" },
    contextLine: `Asking about ${onADay ? dayLabel(trip, focusedDay) : trip.name}`,
    emptyHint: DAY_HINT,
    // NOT a second derivation for a surface that already has one. Plan and Map
    // are the day-or-trip scope the desktop rail already asks about, and
    // `suggestedQuestions` gates every question on the data it would need —
    // which §23's three literal chips ("Rainy-day swap" on an empty day) do
    // not. Reusing it is what keeps the phone from growing the hardcoded array
    // M16 Wave 2 deleted, in phone clothing.
    quickAsks: suggestedQuestions(trip, focusedDay),
  };
}

/**
 * "Fri 26 · Kyoto" — the day rail's own chip, spelled out.
 *
 * Taken from `chipModel` rather than reformatted here so the sheet and the chip
 * behind it can never disagree about what day you are looking at: the weekday /
 * date-number shape, the `Day N` fallback for a day with no date, and the
 * walk-back rule that decides a day's city (`cityFor`) all have exactly one
 * implementation, and this is not a second one.
 */
function dayLabel(trip: TripDetail, dayIndex: number): string {
  const chip = chipModel(trip)[dayIndex]!;
  const label = `${chip.dow} ${chip.dateNum}`.trim();
  // A day whose stops name neither a city nor an area has no city at all
  // (`cityFor` returns null and says why). "Fri 26 · " is worse than "Fri 26".
  return chip.city === null ? label : `${label} · ${chip.city}`;
}

/**
 * Both Notebook asks name "this page", so both need one open.
 *
 * On the index there is none, and the sheet is trip-scoped — "Summarise this
 * page" there would be a chip pointing at nothing, and the assistant's refusal
 * would read as the assistant being broken rather than the chip being wrong.
 * §23's table lists both asks against the index anyway; that is design ahead of
 * this rule, not this rule ignoring the design, and the index deliberately ends
 * up with no asks until something honest exists to put there.
 */
function notebookQuickAsks(page: PhoneAskPage | null): string[] {
  if (page === null) return [];
  const asks: string[] = [];
  if (page.unsetUpWidgets !== null && page.unsetUpWidgets > 0) asks.push("What is not set up?");
  asks.push("Summarise this page");
  return asks;
}
