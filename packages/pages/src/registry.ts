import { z } from "zod";
import type { WidgetShape } from "@tc/contracts";
import { FilterDimension } from "@tc/contracts";
import type { AnyMacroDef, ItemScope, Rendered, Seg, WidgetContext, WidgetInput, WidgetSelection } from "./registry-types";
import { ghost, text } from "./registry-types";
import type { UnavailableReason, UnboundNeeds } from "./result";
import { fieldAt, fieldChoices } from "./fields";
import { VALUE_KIND_FORMATS } from "./kinds";
import { paramKeyOf, withheldFilters } from "./filters";
import { cost, count, dates, hours, city } from "./macros/primitives/single";
import { attribute } from "./macros/primitives/attribute";
import { dayDetail, cityDetail } from "./macros/primitives/block";
import { dayRows, cityRows, stopRows, costRows } from "./macros/primitives/rows";
import { open } from "./macros/primitives/open";
import { countryFactsWidget } from "./macros/primitives/countryFacts";
import { tripStripWidget } from "./macros/primitives/tripStrip";
import { costChart } from "./macros/primitives/spendByDay";
import { costBreakdown } from "./macros/primitives/spendBreakdown";
import { field } from "./macros/primitives/field";
import { daySun, dayFromHome } from "./macros/primitives/time";
import { dayWeather } from "./macros/primitives/weather";
import { internalLink, externalLink } from "./macros/primitives/link";

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
  // The thirteenth (SPEC §25). See `open.ts` for why it is a primitive and not
  // a preset — the short version is that nothing above it resolves a conflict,
  // an empty day or the backlog, so there is no primitive for it to be a
  // preset OF. ADR-039's count in the comment above is amended, not ignored.
  open,
  // "Know before you go" (M14 link 11) — registered and not a primitive, for
  // `open`'s reason: it has no entity to narrow. See `countryFacts.ts`.
  countryFactsWidget,
  // "Trip strip" (M14 link 11), on the same terms. See `tripStrip.ts`.
  tripStripWidget,
  // "Spend by day" (M14 link 11): a primitive, `stop` + filters drawn as a chart.
  costChart,
  // "Spend by kind" / "Spend by tag" (2026-09-26): the same stops and money
  // as a pie per kind or per tag — its own primitive, not a `view` of the
  // bars, because its filters differ. See `spendBreakdown.ts`.
  costBreakdown,
  // The field widget (M14 build step 6): `stop` + filters + a reader-chosen
  // manifest field. The first registered widget with a `field` input.
  field,
  // The clock pair (M14 link 11): day primitives over the zone and place the
  // server put on each day of the globals projection. See `time.ts`.
  daySun, dayFromHome,
  // "Weather" (M14 link 11): a day primitive over data the trip does not hold,
  // handed in pre-fetched (ADR-052). The first registered widget with `needs`.
  dayWeather,
  // The two link widgets (M30, ADR-056): no selection, so not primitives. In
  // the assistant's vocabulary since ADR-057, behind its `insert_widget` guards.
  internalLink, externalLink,
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
  // `because` rides through: a resolver that said WHY it is empty has said the
  // only useful thing it had, and dropping it here would have made
  // `MacroResult.because` unreachable from the one call site that renders.
  | { status: "empty"; because?: string }
  // `shape` is always present here: the resolver's own, or `fallbackShape`.
  | { status: "unbound"; needs: UnboundNeeds; shape: readonly Seg[] }
  // No shape, and never one: ADR-052's `unavailable` is not a ghost.
  | { status: "unavailable"; reason: UnavailableReason }
  | { status: "unknown" }
  | { status: "bad-params"; message: string };

// `item` is the repeat line this widget is being rendered on, when it sits in a
// repeat's template (ADR-035 decision 4). Render-time only: it never reaches
// the stored node.
export function renderMacro(ctx: WidgetContext, name: string, rawParams: unknown, item?: ItemScope): RenderOutcome {
  const def = getMacro(name);
  if (!def) return { status: "unknown" };
  const parsed = def.params.safeParse(rawParams ?? {});
  if (!parsed.success) return { status: "bad-params", message: parsed.error.message };
  const outcome = def.resolve(ctx, parsed.data as never, item);
  if (outcome.status === "ok") return { status: "ok", rendered: def.render(outcome.value) };
  if (outcome.status === "unbound") return { ...outcome, shape: outcome.shape ?? fallbackShape(def) };
  return outcome;
}

/**
 * The ghost of a widget whose resolver did not describe its own, from the one
 * thing every widget declares: its shape. A value for `single` — `text`, whose
 * `———` claims no format it cannot keep — and `NN rows` for a block or a
 * repeat, the framework spec's ghost caption, because how many is exactly what
 * nobody has chosen yet. Named by the widget's title, since that is all a
 * generic ghost knows about what it stands for.
 */
function fallbackShape(def: AnyMacroDef): readonly Seg[] {
  return def.shape === "single" ? [ghost("text", def.title)] : [ghost("count", def.title), text(" rows")];
}

/**
 * The PRIMITIVE vocabulary, for callers that compose the general form.
 *
 * Two of them, and both want the same thing: the assistant's `insert_widget`
 * tool, which names a widget and its params directly, and any test sweeping the
 * registry. Neither wants the preset list — a preset is a curated name for a
 * combination, and a model that can write `{ kind: "pending" }` does not need
 * one — so this is what the assistant's widget search is built over
 * (`widgetSearch.ts`). It rode whole in every page turn's prompt until ADR-057.
 *
 * People browse `presetCatalog()`; code composes with this. That split is
 * ADR-039 decision 5: *"the combination space is not the browsable list; the
 * preset list is"* — and the model works in the combination space.
 */
export function primitiveCatalog(): CatalogueEntry[] {
  // Only what the assistant may insert: a widget it cannot insert would be a
  // catalogue entry it is told about and then refused for (ADR-056).
  return DEFS.filter((d) => d.composable !== false).map(catalogueEntry);
}

/**
 * The widget names the assistant may insert — `MACRO_NAMES` less any that
 * declares `composable: false`. `insert_widget` closes its name enum over THIS
 * list, so such a widget cannot be composed even by a model told its name.
 * None declares it today: the two link widgets did (ADR-056) until ADR-057 gave
 * the assistant a guarded way to insert each.
 */
export const COMPOSABLE_MACRO_NAMES: readonly string[] = DEFS.filter((d) => d.composable !== false).map((d) => d.name);

/** One widget as the assistant's catalogue lists it. */
export interface CatalogueEntry {
  name: string; title: string; shape: WidgetShape; description: string; emptyText: string;
  preview: string; inputs: readonly WidgetInput[]; selection: WidgetSelection | undefined;
  params: Record<string, readonly string[] | null>;
  /**
   * For each `field` input, the fields it may name: the stored path and the
   * label a person would use, so a model asked for "what each stop costs" can
   * find `stop.cost`. A `multiple` input (`stop.rows`' `columns`) takes a list
   * of these paths; its entry in `inputs` says so. **Absent, not `{}`, on a widget with no field input** —
   * `get_widget` hands an entry to a model, and an empty key is tokens for nothing.
   */
  fields?: Record<string, readonly { path: string; label: string }[]>;
}

/** One def's catalogue entry. */
function catalogueEntry(d: AnyMacroDef): CatalogueEntry {
  const fields = fieldInputChoices(d);
  return {
    name: d.name, title: d.title, shape: d.shape,
    description: d.description, emptyText: d.emptyText, preview: d.preview,
    // What the widget takes, so a caller can say so BEFORE a choice rather than
    // leaving it to discover the widget wants a day.
    inputs: d.inputs,
    // `entity + filters`, so a model composing the general form can see which
    // dimensions are legal for this widget rather than guessing from `inputs`.
    selection: d.selection,
    params: {
      ...nonFilterParams(d),
      // A field param is a plain string in its schema — checked at resolve
      // time, never at write time — so the schema walk reports "no list". The
      // manifest is its list.
      ...Object.fromEntries(Object.entries(fields).map(([name, choices]) => [name, choices.map((c) => c.path)])),
    },
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
}

// The published fields behind each `field` input a def declares, by input name.
function fieldInputChoices(d: AnyMacroDef): Record<string, { path: string; label: string }[]> {
  return Object.fromEntries(
    d.inputs.flatMap((input) =>
      input.type === "field" ? [[input.name, fieldChoices(input.of).map(({ path, label }) => ({ path, label }))]] : [],
    ),
  );
}

/**
 * A primitive's params that are NOT filter dimensions, with their vocabularies.
 *
 * **`attribute` was uninsertable by the assistant without this** (Copilot, PR
 * 141). The catalogue described every widget as a selection plus filters, which
 * is false for two of them: `count` also takes `of`, and `attribute` needs
 * `field` to render anything at all. A model told "every param is a filter" and
 * handed no other vocabulary has no way to ask for the trip's name — it can
 * only insert an `attribute` that resolves to "nothing to show".
 *
 * **Derived from the schema, never listed a second time** (Invariant 5). It
 * walks the params object, skips the closed filter vocabulary, and reads the
 * allowed values straight off a `ZodEnum` — so `AttributeFieldRef` gaining a
 * fifth field reaches the model with no edit here. `null` means the param is
 * not an enum and has no list to give.
 */
function nonFilterParams(def: AnyMacroDef): Record<string, readonly string[] | null> {
  const shape = (def.params as Partial<z.ZodObject<z.ZodRawShape>>).shape;
  if (!shape) return {};
  const out: Record<string, readonly string[] | null> = {};
  for (const [key, schema] of Object.entries(shape)) {
    if ((FilterDimension.options as readonly string[]).includes(key)) continue;
    // `.optional()` is how every one of these is declared, so the enum is one
    // unwrap down. Anything else reports "no list" rather than guessing.
    const inner = schema instanceof z.ZodOptional ? (schema.unwrap() as z.ZodTypeAny) : schema;
    out[key] = inner instanceof z.ZodEnum ? (inner.options as readonly string[]) : null;
  }
  return out;
}

/**
 * Whether "Remove duplicates" means anything for this widget as it is bound.
 *
 * Two facts, both read rather than listed: the widget's params schema declares
 * a boolean `distinct` (today only `field`; `stop.rows` has field inputs but a
 * row per stop, so nothing to collapse), and its one field input points at a
 * published field whose kind's "All" rule `distinct` changes (`kinds.ts` —
 * text, enum, place list; money, dates, counts and durations sum or span). No
 * field chosen, or one no longer published, is `false`: there is nothing yet
 * for the setting to act on.
 */
export function distinctApplies(name: string, params: Record<string, unknown>): boolean {
  const def = getMacro(name);
  const shape = (def?.params as Partial<z.ZodObject<z.ZodRawShape>> | undefined)?.shape;
  const declared = shape?.distinct;
  const inner = declared instanceof z.ZodOptional ? (declared.unwrap() as z.ZodTypeAny) : declared;
  if (!(inner instanceof z.ZodBoolean)) return false;
  const input = def!.inputs.find((i) => i.type === "field" && !i.multiple);
  if (input?.type !== "field") return false;
  const choice = fieldAt(input.of, params[input.name]);
  return choice !== undefined && VALUE_KIND_FORMATS[choice.valueKind].distinct;
}

/**
 * The inputs a widget offers as it is bound: its declared ones, minus any
 * filter its params withhold (`WidgetSelection.withheld`) — "Spend by tag"
 * offers no tag control, "Spend by kind" no kind control. The settings panel,
 * the insert step and a preset's catalogue entry all read this, so none of
 * them offers a control the resolver would ignore.
 */
export function inputsFor(name: string, params: Readonly<Record<string, unknown>>): readonly WidgetInput[] {
  const def = getMacro(name);
  if (!def) return [];
  const withheld = new Set<string>(withheldFilters(def.selection, params).map(paramKeyOf));
  return withheld.size === 0 ? def.inputs : def.inputs.filter((input) => !withheld.has(input.name));
}
