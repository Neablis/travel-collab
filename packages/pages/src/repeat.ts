import type { PageRepeatNode } from "@tc/contracts";
import type { ItemScope, WidgetContext } from "./registry-types";
import type { UnboundNeeds } from "./result";
import { getMacro } from "./registry";
import { insertWidget, type InsertResult } from "./insert";
import { narrow } from "./select";
import { needsBooking } from "./needsBooking";

// The authored repeat (ADR-035 decision 4, M14 link 6): one sentence the
// author writes, rendered once per day, stop or city, with every widget in it
// reading that line's item.
//
// **The stored node names a rows primitive, and that is the whole selection.**
// `{ type: "repeat", attrs: { name: "day.rows", params: { dates } }, content }`
// repeats over exactly the days `day.rows{dates}` would list, through the same
// `narrow` — so a repeat has no private idea of "which days", its filters are
// the rows primitive's filters, and its params are validated by that
// primitive's own `insertWidget`. It is also the shape every stored fixture,
// the v1 → v2 name migration (`day.line` → `day.rows`) and `savedTemplate`'s
// day rebinding already assumed, so the format needed no change (ADR-038):
// `PageRepeatNode` has existed since the AST did, with nothing writing it.
//
// `content` is the row template: ordinary inline content, text and widget
// nodes. The items are never stored (decision 4) — `resolveRepeat` computes
// them from the trip every time the page renders.

/** What a repeat can iterate, and the rows primitive whose selection it borrows. */
export const REPEAT_WIDGETS = { day: "day.rows", stop: "stop.rows", city: "city.rows" } as const;
export type RepeatOver = keyof typeof REPEAT_WIDGETS;

// A Map, not an object: a stored name is any string, and `OVER_OF["toString"]`
// on a plain object is a function, not `undefined` (CodeRabbit, PR #226).
const OVER_OF: ReadonlyMap<string, RepeatOver> = new Map(
  Object.entries(REPEAT_WIDGETS).map(([over, name]) => [name, over as RepeatOver]),
);

/** The collection a stored repeat name iterates, or `null` for a name that is not one. */
export function repeatOver(name: string): RepeatOver | null {
  return OVER_OF.get(name) ?? null;
}

// The rows primitives' params that are NOT a selection: `stop.rows`' `columns`
// are a table's extra columns, and a sentence has no columns — the author
// writes a field widget into the template instead. `only` IS a selection
// ("still to book" is a set of stops), so it stays.
export const TABLE_ONLY_PARAMS: readonly string[] = ["columns"];

export type RepeatInsertResult = { ok: true; node: PageRepeatNode } | Extract<InsertResult, { ok: false }>;

/**
 * Build a validated repeat node with an empty template, or refuse — the one
 * door, as `insertWidget` is for a widget (ADR-037 decision 4). Its filters go
 * through `insertWidget` on the rows primitive itself, so a repeat cannot
 * accept a filter its collection does not.
 */
export function insertRepeat(name: string, params: unknown = {}): RepeatInsertResult {
  if (repeatOver(name) === null) return { ok: false, error: { reason: "unknown-widget", name } };
  const table = typeof params === "object" && params !== null
    ? TABLE_ONLY_PARAMS.filter((key) => key in params)
    : [];
  if (table.length > 0) {
    return {
      ok: false,
      error: { reason: "bad-params", name, message: `a sentence for every item has no ${table.join(", ")}; write a widget into it instead` },
    };
  }
  const checked = insertWidget(name, params);
  if (!checked.ok) return checked;
  return { ok: true, node: { type: "repeat", attrs: checked.node.attrs, content: [] } };
}

export type RepeatOutcome =
  | { status: "ok"; over: RepeatOver; items: readonly ItemScope[] }
  // `emptyText` is the rows primitive's own: a repeat over no days says what
  // `day.rows` says over no days (ADR-035: empty renders `emptyText` in Reading).
  | { status: "empty"; over: RepeatOver; emptyText: string }
  | { status: "unbound"; over: RepeatOver; needs: UnboundNeeds }
  // A name that is not a repeatable collection, or params its primitive
  // refuses. Only a hand-written or future document can hold one.
  | { status: "invalid"; message: string };

/** The items a stored repeat iterates, in the order its rows primitive lists them. */
export function resolveRepeat(ctx: WidgetContext, name: string, rawParams: unknown): RepeatOutcome {
  const over = repeatOver(name);
  const def = getMacro(name);
  if (over === null || !def) return { status: "invalid", message: `nothing called "${name}" can be repeated over` };
  const parsed = def.params.safeParse(rawParams ?? {});
  if (!parsed.success) return { status: "invalid", message: parsed.error.message };
  const params = parsed.data as Record<string, unknown>;
  const { trip, globals } = ctx;
  if (!trip) return { status: "unbound", over, needs: "trip" };

  const selection = narrow(trip, globals, params);
  if (selection.status === "unbound") return { status: "unbound", over, needs: selection.needs };
  if (selection.status !== "ok") return { status: "empty", over, emptyText: def.emptyText };

  const items: ItemScope[] =
    over === "day"
      ? selection.value.days.map((index) => ({ kind: "day", index }))
      : over === "city"
        ? selection.value.cities.map((city) => ({ kind: "city", name: city.name }))
        : selection.value.stops
            .filter(({ activity }) => params.only !== "needsBooking" || needsBooking(activity))
            .map(({ activityId, dayIndex }) => ({ kind: "stop", activityId, dayIndex }));
  return items.length === 0 ? { status: "empty", over, emptyText: def.emptyText } : { status: "ok", over, items };
}

const NOUN: Record<RepeatOver, [one: string, many: string]> = {
  day: ["day", "days"],
  stop: ["stop", "stops"],
  city: ["city", "cities"],
};

/**
 * The rail's label: what the repeat is over and, once known, how many
 * (the 2026-09-19 design-parity section — *"chrome naming what it repeats over
 * and how many"*). `null` is "not known": no trip yet, or a stale binding.
 */
export function repeatLabel(over: RepeatOver, count: number | null): string {
  const [one, many] = NOUN[over];
  const head = `For every ${one}`;
  if (count === null) return head;
  if (count === 0) return `${head} · none yet`;
  return `${head} · ${count} ${count === 1 ? one : many}`;
}
