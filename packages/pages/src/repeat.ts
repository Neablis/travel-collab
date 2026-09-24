import {
  REPEAT_SCOPES, REPEAT_SCOPE_ORDER, SentenceTemplate, parseSentenceTemplate, repeatScopeOf, type PageRepeatNode, type RepeatScope,
} from "@tc/contracts";
import type { ItemScope, WidgetContext } from "./registry-types";
import type { UnboundNeeds } from "./result";
import { getMacro } from "./registry";
import { insertWidget, type InsertResult } from "./insert";
import { narrow } from "./select";
import { needsBooking } from "./needsBooking";
import { sentenceFieldAt } from "./sentence";

// The authored repeat (ADR-035 decision 4, M14 link 6): one sentence the
// author writes, rendered once per day, stop or city, each line reading its own
// item. Since Mitchell's preview comment on PR #221 (2026-09-24) the sentence is
// a string with `{field}` tokens (`sentenceTemplate.ts` in `@tc/contracts`),
// written in the settings panel, where it used to be inline text and widgets
// edited on the page.
//
// **The stored node names a rows primitive, and that is the whole selection.**
// `{ type: "repeat", attrs: { name: "day.rows", params: { dates, template } } }`
// repeats over exactly the days `day.rows{dates}` would list, through the same
// `narrow` — so a repeat has no private idea of "which days", its filters are
// the rows primitive's filters, and they are validated by that primitive's own
// `insertWidget`. `template` is the one param that is the repeat's own.
//
// The items are never stored (decision 4) — `resolveRepeat` computes them from
// the trip every time the page renders.

/** What a repeat can iterate, and the rows primitive whose selection it borrows. */
export const REPEAT_WIDGETS = Object.fromEntries(
  REPEAT_SCOPE_ORDER.map((scope) => [scope, REPEAT_SCOPES[scope].widget]),
) as { readonly [S in RepeatScope]: (typeof REPEAT_SCOPES)[S]["widget"] };
export type RepeatOver = RepeatScope;

/** The collection a stored repeat name iterates, or `null` for a name that is not one. */
export const repeatOver = repeatScopeOf;

// The rows primitives' params that are NOT a selection: `stop.rows`' `columns`
// are a table's extra columns, and a sentence has none — the author writes a
// token into it instead. `only` IS a selection ("still to book" is a set of
// stops), so it stays.
export const TABLE_ONLY_PARAMS: readonly string[] = ["columns"];

/** The sentence a repeat's params hold, or `""` for one not written yet. */
export function repeatTemplate(params: unknown): string {
  const template = typeof params === "object" && params !== null ? (params as { template?: unknown }).template : undefined;
  return typeof template === "string" ? template : "";
}

// A repeat's params split into its own `template` and the rows primitive's
// filters, with the template checked. `ok: false` carries the reason.
function splitParams(
  params: unknown,
): { ok: true; template: string | undefined; filters: unknown } | { ok: false; message: string } {
  if (typeof params !== "object" || params === null || Array.isArray(params) || !("template" in params)) {
    return { ok: true, template: undefined, filters: params };
  }
  const { template, ...filters } = params as Record<string, unknown>;
  const checked = SentenceTemplate.safeParse(template);
  return checked.success
    ? { ok: true, template: checked.data, filters }
    : { ok: false, message: `the sentence ${checked.error.issues[0]?.message ?? "is not a sentence"}` };
}

export type RepeatInsertResult = { ok: true; node: PageRepeatNode } | Extract<InsertResult, { ok: false }>;

/**
 * Build a validated repeat node, or refuse — the one door, as `insertWidget` is
 * for a widget (ADR-037 decision 4). Its filters go through `insertWidget` on
 * the rows primitive itself, so a repeat cannot accept a filter its collection
 * does not; its `template` goes through `SentenceTemplate`.
 */
export function insertRepeat(name: string, params: unknown = {}): RepeatInsertResult {
  if (repeatOver(name) === null) return { ok: false, error: { reason: "unknown-widget", name } };
  const split = splitParams(params);
  if (!split.ok) return { ok: false, error: { reason: "bad-params", name, message: split.message } };
  const filters = split.filters;
  const table = typeof filters === "object" && filters !== null
    ? TABLE_ONLY_PARAMS.filter((key) => key in filters)
    : [];
  if (table.length > 0) {
    return {
      ok: false,
      error: { reason: "bad-params", name, message: `a sentence for each item has no ${table.join(", ")}; write a detail into the sentence instead` },
    };
  }
  const checked = insertWidget(name, filters);
  if (!checked.ok) return checked;
  const own = split.template === undefined ? {} : { template: split.template };
  return { ok: true, node: { type: "repeat", attrs: { name, params: { ...checked.node.attrs.params, ...own } }, content: [] } };
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
  const split = splitParams(rawParams ?? {});
  if (!split.ok) return { status: "invalid", message: split.message };
  const parsed = def.params.safeParse(split.filters ?? {});
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

/**
 * Each collection's starting sentence: what a sentence becomes when the scope
 * picker moves it to a collection that cannot print one of its details. Every
 * token is one its collection publishes (`repeat.test.ts` holds that).
 */
export const DEFAULT_SENTENCES: Readonly<Record<RepeatOver, string>> = {
  day: "{index}: {cities}",
  stop: "{title}",
  city: "Welcome to {name}",
};

/**
 * The same repeat over another collection, as the scope picker writes it:
 * every filter the new collection also takes travels, and so does the sentence
 * — when the new collection can print every detail in it.
 *
 * A filter it does not take is dropped rather than left to make the node
 * invalid — "every stop in Kyoto" becomes "every city in Kyoto", but
 * "every booked stop" becomes "every city", because a city is not booked.
 *
 * **A sentence naming a detail the new collection lacks becomes that
 * collection's starting sentence** (Mitchell, #221 preview: *"Changing repeat
 * pretty much will always break the string templates since they have different
 * names"*). Left alone, `{cities}` in a sentence over stops prints as a
 * gap (`SENTENCE_NO_VALUE`) on every line. Dropping just the stray token would leave
 * "Welcome to !", so the sentence is swapped whole; the scope change is one
 * transaction, so undo brings the old sentence and collection back together.
 */
export function rescopeRepeat(over: RepeatOver, params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const accepted = new Set((getMacro(REPEAT_WIDGETS[over])?.inputs ?? []).map((input) => input.name));
  const next = Object.fromEntries(
    Object.entries(params).filter(([key]) => key === "template" || (accepted.has(key) && !TABLE_ONLY_PARAMS.includes(key))),
  );
  if (typeof next.template === "string" && !printsEveryDetail(over, next.template)) next.template = DEFAULT_SENTENCES[over];
  return next;
}

// Whether every `{token}` in `template` names a detail `over` publishes.
function printsEveryDetail(over: RepeatOver, template: string): boolean {
  return unknownSentenceTokens(over, template).length === 0;
}

/**
 * The keys of every `{token}` in `template` that `over` does not publish, once
 * each, in the order they first appear: `{cities}` in a sentence over stops, or
 * a typo like `{nme}`. The page prints each as a gap (`SENTENCE_NO_VALUE`); the
 * settings panel names them, so the author learns why while still typing.
 */
export function unknownSentenceTokens(over: RepeatOver, template: string): string[] {
  const unknown = new Set<string>();
  for (const part of parseSentenceTemplate(template)) {
    if ("field" in part && sentenceFieldAt(over, part.field) === undefined) unknown.add(part.field);
  }
  return [...unknown];
}

const NOUN: Record<RepeatOver, [one: string, many: string]> = {
  day: ["day", "days"],
  stop: ["stop", "stops"],
  city: ["city", "cities"],
};

/** The noun a person reads for a collection: "day", "stop", "city". */
export const repeatNoun = (over: RepeatOver): string => NOUN[over][0];

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
