import type { TripDetail, PageContext, WidgetShape } from "@tc/contracts";
import type { AnyMacroDef, InlinePayload, BlockPayload, RepeatPayload, Rendered, WidgetContext, WidgetInput, WidgetSelection } from "./registry-types";
import type { MacroResult, UnboundNeeds } from "./result";
import { cost, count, dates, hours, city } from "./macros/primitives/single";
import { attribute } from "./macros/primitives/attribute";
import { dayDetail, cityDetail } from "./macros/primitives/block";
import { dayRows, cityRows, stopRows, costRows } from "./macros/primitives/rows";

// **Twelve primitives, and nothing else** (ADR-039 decision 1; spec §1's table).
//
// It held seventeen NAMED widgets until 2026-09-04, and four of those pairs
// were the same widget written twice — `cost.day` and `cost.trip` differ only
// by whether the day filter is set. Every one of the seventeen is now a preset:
// a `(primitive, params, title, keywords)` row in `presets.ts`, which is DATA,
// is never stored in a document, and can be renamed or retired without
// migrating anything (decision 4).
//
// The documents that carry the old names are rewritten once, on read, by the
// v1 → v2 step in `@tc/contracts`' `PAGE_DOC_MIGRATIONS` (decision 9). Nothing
// here needs a compatibility branch, and deliberately does not have one: a
// registry that still answered to `cost.day` would let a page keep an
// un-migrated node forever and nobody would find out.
const DEFS: AnyMacroDef[] = [
  cost, count, dates, hours, city, attribute,
  dayDetail, cityDetail,
  dayRows, cityRows, stopRows, costRows,
] as unknown as AnyMacroDef[];

export const MACRO_REGISTRY: Record<string, AnyMacroDef> = Object.fromEntries(DEFS.map((d) => [d.name, d]));
export const MACRO_NAMES: readonly string[] = DEFS.map((d) => d.name);

/**
 * The names of the registered primitives — the defs that declare a `selection`.
 *
 * Every registered widget is one now, so this equals `MACRO_NAMES`. It stays a
 * separate derivation rather than an alias because the tests that sweep it are
 * asserting something about the DECLARATION (`entity + filters`), and a widget
 * added tomorrow without one should drop out of those sweeps and fail the count
 * beside them, not silently pass as a primitive because it was registered.
 */
export const PRIMITIVE_NAMES: readonly string[] = DEFS.filter((d) => d.selection).map((d) => d.name);

export function getMacro(name: string): AnyMacroDef | undefined {
  return MACRO_REGISTRY[name];
}

export type ResolveOutcome =
  | MacroResult<InlinePayload | BlockPayload | RepeatPayload>
  | { status: "unknown" }
  | { status: "bad-params"; message: string };

export function resolveMacro(detail: TripDetail, ctx: PageContext, name: string, rawParams: unknown): ResolveOutcome {
  const def = getMacro(name);
  if (!def) return { status: "unknown" };
  const parsed = def.params.safeParse(rawParams ?? {});
  if (!parsed.success) return { status: "bad-params", message: parsed.error.message };
  // `resolveMacro` predates the account being in scope and has no user to
  // pass. Callers that need account widgets go through `renderMacro`, which
  // takes a whole `WidgetContext`; this one keeps working for everything that
  // reads the trip.
  return def.resolve({ trip: detail, page: ctx, user: null, globals: null }, parsed.data as never);
}

// Resolve AND render in one call, which is what every UI wants and what keeps
// `Rendered` the only thing `apps/web` ever sees.
//
// The split matters at the seam, not at the call site: `resolve` is what the AI
// path and the insert preview use on their own, `render` is what turns its
// payload into segments. Going through the registry here means a caller cannot
// pair one widget's payload with another widget's renderer — the two are only
// ever joined by the def they both came from.
export type RenderOutcome =
  | { status: "ok"; rendered: Rendered }
  | { status: "empty" }
  | { status: "unbound"; needs: UnboundNeeds }
  | { status: "unknown" }
  | { status: "bad-params"; message: string };

export function renderMacro(ctx: WidgetContext, name: string, rawParams: unknown): RenderOutcome {
  const def = getMacro(name);
  if (!def) return { status: "unknown" };
  const parsed = def.params.safeParse(rawParams ?? {});
  if (!parsed.success) return { status: "bad-params", message: parsed.error.message };
  const outcome = def.resolve(ctx, parsed.data as never);
  return outcome.status === "ok"
    ? { status: "ok", rendered: def.render(outcome.value) }
    : outcome;
}

/**
 * The PRIMITIVE vocabulary, for callers that compose the general form.
 *
 * Two of them, and both want the same thing: the assistant's `insert_widget`
 * tool, which names a widget and its params directly, and any test sweeping the
 * registry. Neither wants the preset list — a preset is a curated name for a
 * combination, and a model that can write `{ kind: "booked" }` does not need
 * one — so this is what `handleAskRequest` puts in front of the model.
 *
 * People browse `presetCatalog()`; code composes with this. That split is
 * ADR-039 decision 5: *"the combination space is not the browsable list; the
 * preset list is"* — and the model works in the combination space.
 */
export function primitiveCatalog(): {
  name: string; title: string; shape: WidgetShape; description: string; emptyText: string;
  preview: string; inputs: readonly WidgetInput[]; selection: WidgetSelection | undefined;
}[] {
  return DEFS.map((d) => ({
    name: d.name, title: d.title, shape: d.shape,
    description: d.description, emptyText: d.emptyText, preview: d.preview,
    // What the widget takes, so a caller can say so BEFORE a choice rather than
    // leaving it to discover the widget wants a day.
    inputs: d.inputs,
    // `entity + filters`, so a model composing the general form can see which
    // dimensions are legal for this widget rather than guessing from `inputs`.
    selection: d.selection,
  }));
}
