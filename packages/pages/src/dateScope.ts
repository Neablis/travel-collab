// A notebook's `dateScope` (M52 decision 10, ADR-080 §4): which days the
// widgets on a page read when they leave their own day unbound.
//
// **One resolver, and every widget reads it through `narrow`.** The scope is
// handed to a widget exactly where a repeat hands its line's day (`scoped` in
// `select.ts`), so it fills only a day the widget left open and an explicit
// binding still wins. Later notebook settings extend this function rather than
// adding a hook of their own.
//
// Pure (Invariant 4): the reader's clock is handed in, as `tripNow` takes it.
import type { PageContext, TripDetail, TripGlobals } from "@tc/contracts";
import type { AnyMacroDef, ItemScope, NoDay, WidgetContext, WidgetScope } from "./registry-types";
import { tripNow, type TripNowClock } from "./now";

/**
 * The scope a page hands every widget that follows it: today's day while the
 * trip is under way, *no day* on any other date, or `undefined` for none.
 *
 * Today is always the real today (Mitchell, 2026-10-22): before the trip and
 * after it the scope is `no-day`, and each widget renders its own empty state
 * rather than being shown day 1. `undefined` while the reader's clock is not
 * known, as the server's and the assistant's contexts are, so they read the
 * page as it is stored. `{ date }` is in the contract with no control yet
 * (decision 10), and scopes nothing until it has one.
 */
export function resolveDateScope(
  context: PageContext,
  trip: TripDetail | undefined,
  globals: TripGlobals | null,
  now: TripNowClock | null,
): Extract<ItemScope, { kind: "day" }> | NoDay | undefined {
  if (context.dateScope !== "today" || trip === undefined || now === null) return undefined;
  const { dayId } = tripNow(trip, globals, now);
  const index = trip.days.findIndex((day) => day.dayId === dayId);
  return index === -1 ? { kind: "no-day" } : { kind: "day", index };
}

/**
 * Whether a page's scope reaches this widget: it selects days (`day` or
 * `dates` among its filters) and its author bound neither. The picker's
 * *follows today* reads this too, so the mark cannot promise what the render
 * does not do.
 */
export function followsDateScope(def: Pick<AnyMacroDef, "selection"> | undefined, params: Readonly<Record<string, unknown>>): boolean {
  const filters = def?.selection?.filters ?? [];
  return (filters.includes("day") || filters.includes("dates")) && params.day === undefined && params.dates === undefined;
}

/** The date scope a page hands this widget, or `undefined` when the widget does not follow it. */
export function pageScope(ctx: WidgetContext, def: AnyMacroDef, params: Readonly<Record<string, unknown>>): WidgetScope | undefined {
  return followsDateScope(def, params) ? resolveDateScope(ctx.page, ctx.trip, ctx.globals, ctx.now ?? null) : undefined;
}
