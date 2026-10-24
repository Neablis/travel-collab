// A notebook's `dateScope` (M52 decision 10, ADR-080 §4): which days the
// widgets on a page read when they leave their own day unbound.
//
// **One resolver, and every widget reads it through `narrow`.** The scope is
// handed to a widget exactly where a repeat hands its line's day (`scoped` in
// `select.ts`), so it fills only a day the widget left open. On a Today page
// the notebook's Today supersedes a day or dates stored on the widget
// (`supersededParams`), so none is left set there. Later notebook settings
// extend this function rather than adding a hook of their own.
//
// Pure (Invariant 4): the reader's clock is handed in, as `tripNow` takes it.
import type { FilterDimension, PageContext, TripDetail, TripGlobals } from "@tc/contracts";
import type { AnyMacroDef, ItemScope, NoDay, WidgetContext } from "./registry-types";
import { paramKeyOf } from "./filters";
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
export function pageScope(ctx: WidgetContext, def: AnyMacroDef, params: Readonly<Record<string, unknown>>): ReturnType<typeof resolveDateScope> {
  return followsDateScope(def, params) ? resolveDateScope(ctx.page, ctx.trip, ctx.globals, ctx.now ?? null) : undefined;
}

/**
 * The trip day nearest `today`: today clamped into the trip's dates, then the
 * day on that date (or the last before it, across a gap). Day 1 before the
 * trip, today's day during it, the last day after it. `null` with no dates.
 *
 * Whose place a Today page reads today's weather and light at, off the trip's
 * dates as on them (Mitchell, 2026-10-24: *"the least amount of special
 * casing"*). The widget and the weather route both read it, so they agree.
 */
export function nearestTripDay(days: readonly { date: string | null }[], today: string): number | null {
  let nearest: number | null = null;
  days.forEach((day, index) => {
    if (day.date === null) return;
    // Days are in date order: the last on or before today, else the first.
    if (nearest === null || day.date <= today) nearest = index;
  });
  return nearest;
}

/**
 * The trip day whose place a Today page reads off the trip's dates
 * (`nearestTripDay`), on the first day's clock as `tripNow` counts to the start.
 */
export function standInDay(trip: TripDetail, globals: TripGlobals | null, now: TripNowClock): number | null {
  const { firstDayToday } = tripNow(trip, globals, now);
  return firstDayToday === null ? null : nearestTripDay(trip.days, firstDayToday);
}

/**
 * **Notebook settings and the widget params each takes over while it is set**
 * (Mitchell, 2026-10-24: *"we might have future global settings for notebooks
 * that might change the params possible in a widget"*). A new setting is a
 * row here; `supersededParams` is the one reader, behind the inputs a widget
 * offers (`inputsFor`) and the params it renders with (`renderMacro`).
 *
 * A setting takes over a filter only on a widget that selects by it.
 */
const NOTEBOOK_SETTINGS: readonly {
  isSet: (page: Pick<PageContext, "dateScope">, now: TripNowClock | null | undefined) => boolean;
  supersedes: readonly FilterDimension[];
}[] = [
  // Today is the day: a day or a range chosen on the widget would be ignored.
  // Not without a clock, where the page scopes nothing (`resolveDateScope`)
  // and dropping the stored day would leave the widget reading every day.
  { isSet: (page, now) => page.dateScope === "today" && now !== null, supersedes: ["day", "dates"] },
];

/**
 * The params of this widget that the page's settings take over, by name.
 * `now` is the render's clock, `null` when it has none; the settings panels
 * leave it out and are shown the page as a reader with a clock sees it.
 */
export function supersededParams(
  page: Pick<PageContext, "dateScope"> | undefined,
  def: Pick<AnyMacroDef, "selection"> | undefined,
  now?: TripNowClock | null,
): readonly string[] {
  const filters = def?.selection?.filters ?? [];
  if (page === undefined || filters.length === 0) return [];
  return NOTEBOOK_SETTINGS.filter((setting) => setting.isSet(page, now)).flatMap((setting) =>
    setting.supersedes.filter((dimension) => filters.includes(dimension)).map(paramKeyOf),
  );
}

/**
 * `params` without what the page's settings take over: a value stored before
 * the setting was, or written by hand, is read as unset, so the setting wins
 * (`withoutWithheld`'s rule, one level up). `now` as `supersededParams` reads it.
 */
export function withoutSuperseded<P extends Readonly<Record<string, unknown>>>(
  page: Pick<PageContext, "dateScope"> | undefined,
  def: Pick<AnyMacroDef, "selection"> | undefined,
  params: P,
  now?: TripNowClock | null,
): P {
  const superseded = supersededParams(page, def, now).filter((name) => name in params);
  if (superseded.length === 0) return params;
  const kept: Record<string, unknown> = { ...params };
  for (const name of superseded) delete kept[name];
  return kept as P;
}
