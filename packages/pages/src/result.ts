import type { Seg } from "./registry-types";

// What a widget's `resolve` can answer.
//
// `unbound` carries WHAT is missing, because the two cases read differently to
// a person: a widget with no day chosen is something they can fix from the
// chrome row, and a widget on a notebook with no trip is not.
/**
 * What a widget can be missing — **one member per `WidgetInput` type that has an
 * unbound state**, and `tags` is the one that has none.
 *
 * It read `"day" | "trip"` while `WidgetInput` already declared five types, so a
 * widget taking a range or a person could not report "not set up" without a cast
 * or a contract change: the framework's total state was total only for the two
 * inputs that happened to exist. Found by Copilot on PR 139. `registry-types.ts`
 * carries a compile-time check that the two lists stay in step, so adding an
 * input type without a `needs` member is a type error rather than a discovery.
 *
 * **`tags` is excluded on purpose, not by omission.** ADR-037 decision 9: an
 * absent tag means "every stop", which is a real binding — a `tags` input is
 * never waiting for a choice, so a widget that reported `unbound: "tags"` would
 * be describing a state it cannot be in.
 *
 * **`trip` outlived its input.** The `trip` and `days` input types were retired
 * on 2026-09-24 (KI-2026-09-05-i item 2), and `days` went with them because
 * nothing could report it. `trip` stays: a notebook with no trip is a state
 * every resolver must answer (`needsTrip`), not a choice any control makes.
 */
export type UnboundNeeds = "day" | "person" | "trip" | "field" | "target" | "url";

/**
 * Why a widget that reads outside data has nothing to show (ADR-052 decision 4).
 *
 * `pending` — the request has not landed, or the reader's date is not known
 * yet so the mode cannot be chosen. `source` — the outside service did not
 * answer, or our own quota refused to ask it.
 *
 * **Not `unbound` and not `empty`, and the difference is who can fix it.**
 * `unbound` is something the author can set, so it draws a ghost and counts as
 * "not set up"; `empty` is the trip lacking what the widget reads. Here the trip
 * has what is needed and the world did not answer, so there is no ghost, no
 * bind action and nothing counted against the author.
 */
export type UnavailableReason = "pending" | "source";

export type MacroResult<T> =
  | { status: "ok"; value: T }
  | {
      status: "empty";
      /**
       * Why this one is empty, when the widget has more than one way to be.
       *
       * `MacroDef.emptyText` is a single string per widget, which is right for
       * a widget with one empty meaning — `day.rows` is empty because there are
       * no days, and there is nothing else it could be. It is wrong for
       * `attribute`, which is five different questions behind one primitive:
       * "nothing to show" is the same shrug whether the trip has no name, no
       * budget or no dates, and on a brand-new trip's Overview that shrug is
       * the entire page.
       *
       * Absent means "use the widget's own `emptyText`", so every existing
       * resolver keeps the state it had.
       */
      because?: string;
    }
  | {
      status: "unbound";
      needs: UnboundNeeds;
      /**
       * What the value WILL look like — the Editing-mode ghost, per part
       * (notebook-widget-framework spec, "The ghost"). A bound part is a real
       * `chip` and an unbound one a `ghost` of its value kind, so a half-bound
       * widget reads half bound. Optional: a resolver that supplies none gets
       * a generic one from its widget's shape in `renderMacro`, which is what
       * lets a new widget ghost without writing one.
       */
      shape?: readonly Seg[];
    }
  // Deliberately no `shape`: `unavailable` never ghosts (ADR-052 decision 4).
  | { status: "unavailable"; reason: UnavailableReason };

export const ok = <T>(value: T): MacroResult<T> => ({ status: "ok", value });
export const empty = (because?: string): MacroResult<never> =>
  because === undefined ? { status: "empty" } : { status: "empty", because };
/** A widget whose outside source has not answered (yet) — see `UnavailableReason`. Never a ghost. */
export const unavailable = (reason: UnavailableReason): MacroResult<never> => ({ status: "unavailable", reason });
export const unbound = (needs: UnboundNeeds, shape?: readonly Seg[]): MacroResult<never> =>
  shape === undefined ? { status: "unbound", needs } : { status: "unbound", needs, shape };

/**
 * Whether an unbound widget renders as its ghost in Editing, per `needs`.
 * Reading never does: Mitchell, 2026-09-24 (M14 "Decided" item 2) — *"keep it
 * during edits, and when done editing, have a placeholder like it already
 * has"* — so Reading keeps the short label for every member.
 *
 * **Stale is not a ghost** (framework spec, inline rule 6). A ghost says "bind
 * me". `day` is reachable only as a ref to a day that was DELETED, and a ghost
 * there sends an author to bind something already bound, so it keeps "that day
 * was removed" in both modes. `person` is bound too, to a dimension no field
 * can answer yet (ADR-039 decision 7); a ghost would invite a choice no control
 * can make.
 *
 * A `field` path the manifest stopped publishing is stale in the spec's sense
 * and ghosts anyway: it reports the same `needs` as a field never chosen, and
 * M14 decision 4 turns a removed field's widget into plain text instead.
 */
export const UNBOUND_GHOSTS: Record<UnboundNeeds, boolean> = {
  trip: true, field: true, day: false, person: false,
  // A link with nowhere to go yet is "bind me" in the plainest sense (ADR-056):
  // its settings hold the one control that answers it.
  target: true, url: true,
};

// The answer every trip-reading widget gives when handed a context with no
// trip. Named rather than inlined seven times so the reason survives: ADR-037
// open question 2 requires every resolver to handle an absent trip, because
// root-account notebooks are the stated direction — and a resolver that
// assumes a trip is one that has to be rewritten when they arrive.
export const needsTrip = (shape?: readonly Seg[]): MacroResult<never> => unbound("trip", shape);
