import type { TripWeather } from "@tc/contracts";
import { MacroNode, PageRepeatNode } from "@tc/contracts";
import { ok, unavailable, type MacroResult } from "./result";

// Data the trip does not hold, reaching a widget as a PRE-FETCHED input
// (ADR-052 decision 3). Resolvers stay pure and synchronous: the client fetches,
// and `resolve` reads what it is handed, exactly as it reads `globals`.

/**
 * One outside input as the resolver sees it. There is no "as of" on the slot:
 * the as-of the reader is shown is the SOURCE's (MET's model run), and it rides
 * inside the value (`ForecastDay.asOf`) because a stale row served after a
 * failed revalidation has an older one than its neighbours (decision 7).
 */
export type Slot<T> = { state: "pending" } | { state: "failed" } | { state: "ready"; value: T };

/**
 * One notebook as a link card reads it (ADR-056): enough to title and describe
 * it, and nothing that would put the notebook's document on every page that
 * links to it.
 */
export interface NotebookRef {
  id: string;
  title: string;
  /** The notebook's first line of prose, or `null` when it opens on a widget or nothing. */
  firstLine: string | null;
  widgetCount: number;
}

/**
 * The trip's notebooks, as the reader's own `GET /pages` answered.
 *
 * `openable` is whether this reader can follow a link INTO one. The demo's
 * visitor and an invitee having a look first read the trip through a token,
 * and the notebook route is not one they can open — the board withholds the
 * Notebooks menu from both for that reason (`TripBoardScreen`). A card that
 * navigated there anyway would be a link to a page the viewer cannot open, so
 * it draws the notebook's name without the link.
 */
export interface NotebookIndex {
  pages: readonly NotebookRef[];
  openable: boolean;
}

/**
 * Every outside input a widget can declare. The next one is a member here, not an architecture.
 *
 * **`notebooks` is the first that is not a third party's** (ADR-056). It is
 * here rather than on `WidgetContext` beside `globals` because it has exactly
 * a slot's lifecycle — asked for only when a widget on the page names it,
 * `pending` until it lands, `failed` if it does not — and every piece of that
 * (the loading chip, the first-paint rule in `templates.ts`, `NO_EXTERNAL` for
 * the server) already exists for weather.
 */
export interface ExternalInputs {
  weather: Slot<TripWeather>;
  // Optional, and absent reads as `pending`: every context built before this
  // input existed — the weather tests, the assistant's — means exactly that.
  notebooks?: Slot<NotebookIndex>;
}

/** What `MacroDef.needs` may name. */
export type ExternalNeed = keyof ExternalInputs;

/**
 * What a context with no `external` means: every slot still pending.
 *
 * Server-side resolvers (the assistant) pass this and never trigger a fetch, so
 * the assistant is not a second route by which a trip's locations leave.
 */
export const NO_EXTERNAL: ExternalInputs = { weather: { state: "pending" }, notebooks: { state: "pending" } };

/**
 * A slot as a result a resolver can return early on: `ok(value)` when it has
 * landed, `unavailable` otherwise.
 *
 * `failed` is `source` and never `empty`: the trip had what was needed, so
 * saying "nothing to show" would put the world's failure on the author.
 */
export function readSlot<K extends ExternalNeed>(
  external: ExternalInputs | undefined,
  need: K,
): MacroResult<NonNullable<ExternalInputs[K]> extends Slot<infer T> ? T : never> {
  const slot: Slot<unknown> = (external ?? NO_EXTERNAL)[need] ?? { state: "pending" };
  switch (slot.state) {
    case "ready":
      return ok(slot.value as never);
    case "pending":
      return unavailable("pending");
    case "failed":
      return unavailable("source");
    default: {
      const exhaustive: never = slot;
      return exhaustive;
    }
  }
}

/**
 * Which outside inputs the widgets in a document declare.
 *
 * This is the "only when the page shows weather" rule (decision 3): the client
 * asks for an input only when this names it, so a notebook with no weather
 * widget sends no location anywhere. Walks `content` at any depth, the way
 * `findWidgetError` does; a node that is not a valid macro, or names a widget
 * this build does not know, declares nothing. A repeater is a widget too (its
 * `attrs.name`), and its row template is walked for the widgets inside it.
 *
 * `lookup` is injected so a test can supply a widget that declares a need
 * before any registered one does.
 */
export function externalNeedsOf(
  nodes: readonly unknown[],
  lookup: (name: string) => { needs?: readonly ExternalNeed[] } | undefined,
): ReadonlySet<ExternalNeed> {
  const found = new Set<ExternalNeed>();
  const walk = (list: readonly unknown[]): void => {
    for (const node of list) {
      if (typeof node !== "object" || node === null) continue;
      const record = node as Record<string, unknown>;
      if (record.type === "macro") {
        const parsed = MacroNode.safeParse(node);
        if (parsed.success) for (const need of lookup(parsed.data.attrs.name)?.needs ?? []) found.add(need);
        continue;
      }
      if (record.type === "repeat") {
        const parsed = PageRepeatNode.safeParse(node);
        if (parsed.success) for (const need of lookup(parsed.data.attrs.name)?.needs ?? []) found.add(need);
      }
      if (Array.isArray(record.content)) walk(record.content);
    }
  };
  walk(nodes);
  return found;
}
