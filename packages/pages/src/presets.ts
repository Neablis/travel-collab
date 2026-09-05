import type { WidgetShape } from "@tc/contracts";
import { WIDGET_NAME_MIGRATION } from "@tc/contracts";
import type { WidgetInput } from "./registry-types";
import { getMacro } from "./registry";
import { insertWidget, type InsertResult } from "./insert";

/**
 * **A named widget is a preset, and a preset is data** (ADR-039 decision 4).
 *
 * A row of `(primitive, params, title, keywords)`. It is not stored in a
 * document — the document stores the primitive and its filters, which is what
 * it stored before — so:
 *
 * - renaming, adding or retiring a preset **never migrates a document**. Only
 *   the primitive vocabulary can, and it changes far more rarely than the list
 *   of things worth naming;
 * - rebinding a preset away from its params is not an error state. It is just
 *   the general widget, which is what it always was.
 *
 * `id` is what the picker keys on and what a person searches by. It is NOT
 * stored: `insertPreset` writes `(widget, params)` into the document. Keeping
 * the retired names as ids is deliberate and is §6's last line — *"filter
 * values are searchable through their presets, which is how `/booking` still
 * finds something after `booking.line` stops existing"*.
 */
export interface WidgetPreset {
  id: string;
  /** The primitive this inserts. */
  widget: string;
  /** The filters the NAME carries. Merged with whatever the author binds later. */
  params: Readonly<Record<string, unknown>>;
  title: string;
  /**
   * What somebody would type looking for this, beyond its title (§6).
   *
   * Search matched title, description and name as one substring, so "day cost"
   * found nothing at all. Every word of a query must now match something, and
   * these are what the words match.
   */
  keywords: readonly string[];
  /** Overrides the primitive's, when the preset is about something narrower. */
  description?: string;
  preview?: string;
}

/**
 * The browsable list (ADR-039 decision 5: *"the combination space is not the
 * browsable list; the preset list is"*).
 *
 * **Curated, not mechanical.** The spec's §4 table has seventeen rows because it
 * is also the migration map, and four of those pairs are the same widget
 * written twice — the whole finding ADR-039 opens with. Listing both halves of
 * a pair would put two rows in the picker that insert the identical node, which
 * is the duplication this change exists to remove, one layer up. So `cost.trip`
 * and `cost.day` are ONE row here ("What it costs", pointed at a day or not),
 * and both names still migrate to their own params and both still find that row
 * by keyword.
 *
 * What is here that no widget covered before: `count`, `city.detail`, and the
 * two filtered rows §4 asks for by name — *how many stops are booked* and
 * *everything on a day, booked only*.
 */
export const PRESETS: readonly WidgetPreset[] = [
  // ---- one value, in a sentence -----------------------------------------
  {
    id: "cost",
    widget: "cost",
    params: {},
    title: "What it costs",
    keywords: ["total", "spend", "price", "sum", "budget", "money", "day", "trip"],
    preview: "the running total — the whole trip, or just what you point it at",
  },
  {
    id: "count",
    widget: "count",
    params: {},
    title: "How many stops",
    keywords: ["number", "count", "how many", "stops", "activities"],
  },
  {
    id: "count.booked",
    widget: "count",
    params: { kind: "booked" },
    title: "How many are booked",
    keywords: ["number", "count", "booked", "confirmed", "reserved", "progress"],
    description: "How many stops are booked. Point it at a day for that day's.",
    preview: "how many of them are booked",
  },
  {
    id: "dates",
    widget: "dates",
    params: {},
    title: "The dates",
    keywords: ["date", "when", "range", "day", "trip", "calendar"],
  },
  {
    id: "hours",
    widget: "hours",
    params: {},
    title: "First and last",
    keywords: ["time", "hours", "window", "start", "end", "schedule", "morning", "night"],
  },
  {
    id: "city",
    widget: "city",
    params: {},
    // "Which cities", not "The cities": `city.detail` below is "The cities, in
    // detail", and a title that is a strict PREFIX of another one is genuinely
    // ambiguous — for a person scanning the list, and for every test that finds
    // a row by its name.
    title: "Which cities",
    keywords: ["city", "cities", "where", "place", "location"],
  },
  // ---- `attribute`, one preset per allow-listed field --------------------
  {
    id: "trip.name",
    widget: "attribute",
    params: { field: "trip.name" },
    title: "The trip's name",
    keywords: ["name", "title", "trip"],
    description: "The trip's name.",
    preview: "Japan, spring",
  },
  {
    id: "budget.remaining",
    widget: "attribute",
    params: { field: "trip.budgetRemaining" },
    title: "What's left of the budget",
    keywords: ["budget", "remaining", "left", "money", "over", "under"],
    description: "The trip's budget minus what it costs so far. Negative when over budget.",
    preview: "what's left to spend",
  },
  {
    id: "account.name",
    widget: "attribute",
    params: { field: "account.name" },
    title: "Your name",
    keywords: ["me", "my name", "account", "profile", "who"],
    description: "The name on your account.",
    preview: "the name on your account",
  },
  {
    id: "account.homeAirport",
    widget: "attribute",
    params: { field: "account.homeAirport" },
    title: "Your home airport",
    keywords: ["airport", "home", "flight", "iata", "account"],
    description: "Your home airport, as a three-letter code.",
    preview: "your home airport code",
  },
  // ---- a section of its own ----------------------------------------------
  {
    id: "day.detail",
    widget: "day.detail",
    params: {},
    title: "The days, in detail",
    keywords: ["itinerary", "schedule", "agenda", "plan", "day", "days", "stops"],
    preview: "every stop, day by day — or one day, if you point it at one",
  },
  {
    id: "day.detail.booked",
    widget: "day.detail",
    params: { kind: "booked" },
    title: "The days, bookings only",
    keywords: ["itinerary", "booked", "confirmed", "reservations", "day", "days"],
    description: "The booked stops on each day, skipping the days with none.",
    preview: "each day's bookings, and nothing else",
  },
  {
    id: "city.detail",
    widget: "city.detail",
    params: {},
    title: "The cities, in detail",
    keywords: ["city", "cities", "where", "places", "overview"],
  },
  // ---- a line each --------------------------------------------------------
  {
    id: "day.line",
    widget: "day.rows",
    params: {},
    title: "A line for every day",
    keywords: ["day", "days", "list", "line", "summary", "overview"],
  },
  {
    id: "city.line",
    widget: "city.rows",
    params: {},
    title: "A line for every city",
    keywords: ["city", "cities", "list", "line", "where"],
  },
  {
    id: "stop.line",
    widget: "stop.rows",
    params: {},
    title: "A line for every stop",
    keywords: ["stop", "stops", "activities", "things to do", "list", "line"],
  },
  {
    id: "booking.line",
    widget: "stop.rows",
    params: { kind: "booked" },
    title: "A line for every booking",
    keywords: ["booking", "bookings", "booked", "confirmed", "hotel", "flight", "reservation"],
    description: "One line per booked stop: when it is, and what it cost.",
    preview: "one line per booking, with its time and cost",
  },
  {
    id: "costs.table",
    widget: "cost.rows",
    params: {},
    title: "Costs, broken down",
    keywords: ["cost", "costs", "money", "breakdown", "table", "spend", "total"],
  },
];

const BY_ID: Record<string, WidgetPreset> = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string): WidgetPreset | undefined {
  return BY_ID[id];
}

/**
 * The primitive a preset inserts, with the preset's own filters already in it.
 *
 * `extra` is what a surface has bound on top — the phone's *Point it at* step
 * binds before the widget lands. It wins over the preset's params, which is
 * decision 4's *"rebinding a preset away from its params is not an error
 * state"* said in code: an author who picks "A line for every booking" and then
 * chooses a different kind gets that kind, not a refusal.
 *
 * It assumes `extra` IS a record — `insertPreset` checks that before calling,
 * because a spread is the wrong place to find out (see below).
 */
export function presetParams(
  preset: WidgetPreset,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return { ...preset.params, ...extra };
}

// Object, not null, not an array — the shape a spread can merge without
// silently changing what the caller asked for.
function isParamRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Insert a preset — **through `insertWidget`, never around it.**
 *
 * ADR-037 decision 4 is that there is exactly one way a widget enters a
 * document, and a preset is a shortcut for choosing its arguments, not a second
 * door. So this resolves the preset to `(primitive, params)` and hands both to
 * the same validator every other caller uses.
 */
export function insertPreset(id: string, extra: unknown = {}): InsertResult {
  const preset = getPreset(id);
  // The same typed refusal an unknown widget gets. A preset id is not a widget
  // name, but from a caller's point of view "I asked for a thing that is not
  // there" is one outcome, and inventing a second error shape for it would make
  // every call site handle two.
  if (!preset) return { ok: false, error: { reason: "unknown-widget", name: id } };
  // **A non-record override is a caller error, not "no override".**
  // `{ ...preset.params, ...null }` is a silent no-op in JS, so
  // `insertPreset("booking.line", null)` handed `insertWidget` the preset's own
  // `{ kind: "booked" }` and came back `ok` — the caller's input discarded by
  // the one path whose whole job is to refuse bad input.
  //
  // This is the SAME hole `insertWidget` already closed one layer down, where
  // `params ?? {}` turned an explicit `null` into an empty object (CodeRabbit,
  // PR 139) — reopened by the spread above. So `extra` is `unknown` here for
  // exactly the reason `insertWidget`'s `params` is: the preset door and the
  // general door have to refuse the same inputs, or the preset door is the
  // second insert path ADR-037 decision 4 exists to forbid.
  if (!isParamRecord(extra)) return insertWidget(preset.widget, extra);
  return insertWidget(preset.widget, presetParams(preset, extra));
}

/**
 * What the picker, the slash menu and the phone sheet read.
 *
 * `name` is the PRESET's id, because that is the identifier those surfaces key
 * on, search over and pass back to `insertPreset`. `widget` and `params` are
 * what it will actually insert, which the phone's bind step needs so it can
 * start from the preset's own filters rather than from nothing.
 *
 * Everything else falls through from the primitive unless the preset overrides
 * it — one definition of what a `cost` widget is, several names for reaching it.
 */
export interface WidgetCatalogEntry {
  name: string;
  widget: string;
  params: Readonly<Record<string, unknown>>;
  title: string;
  shape: WidgetShape;
  description: string;
  emptyText: string;
  preview: string;
  inputs: readonly WidgetInput[];
  keywords: readonly string[];
  /**
   * The retired widget names that now land on this preset's primitive.
   *
   * Search matches them, so typing `cost.day` — a name somebody read in a
   * document's JSON, or in the AI tool surface, or simply remembers — still
   * finds "What it costs". §6's *"filter values are searchable through their
   * presets"*, extended to the names themselves.
   *
   * Derived from `WIDGET_NAME_MIGRATION`, the SAME map the document migration
   * reads, so the search index and the migration cannot disagree about what
   * `cost.day` became.
   */
  aliases: readonly string[];
}

// A stable spelling of a params object, so two of them can be compared for
// equality. Keys sorted, because `{a, b}` and `{b, a}` are the same filter set
// and JSON order is not a fact about either.
const paramsKey = (params: Readonly<Record<string, unknown>>): string =>
  JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));

/**
 * The retired names each preset answers to, for the search index.
 *
 * **Matched by the preset's PARAMS, not just by its primitive.** Grouping by
 * primitive alone gave every preset over `stop.rows` both retired names, so
 * searching `booking.line` also surfaced "A line for every stop", and
 * `account.homeAirport` surfaced all four `attribute` presets (Copilot, PR
 * 141). A retired name meant one specific combination; the preset that IS that
 * combination is the one it should find.
 *
 * The migration step's `set` is exactly that combination — it is the filter the
 * old NAME carried — so a preset whose own params equal it is the same widget
 * under a new title. A retired name whose combination no preset offers falls
 * back to every preset on its primitive rather than becoming unfindable, which
 * is the honest degradation: the reader gets the family, not nothing.
 */
const RETIRED_NAMES_BY_PRESET: Record<string, string[]> = {};
for (const [retired, step] of Object.entries(WIDGET_NAME_MIGRATION)) {
  const onPrimitive = PRESETS.filter((preset) => preset.widget === step.name);
  const exact = onPrimitive.filter((preset) => paramsKey(preset.params) === paramsKey(step.set ?? {}));
  for (const preset of exact.length > 0 ? exact : onPrimitive) {
    (RETIRED_NAMES_BY_PRESET[preset.id] ??= []).push(retired);
  }
}

export function presetCatalog(): WidgetCatalogEntry[] {
  const entries: WidgetCatalogEntry[] = [];
  for (const preset of PRESETS) {
    const def = getMacro(preset.widget);
    // A preset naming a primitive that does not exist is a broken row, and
    // `presets.test.ts` fails on it by name. Skipping here rather than throwing
    // keeps one bad row from emptying the whole picker at runtime.
    if (!def) continue;
    entries.push({
      name: preset.id,
      widget: preset.widget,
      params: preset.params,
      title: preset.title,
      shape: def.shape,
      description: preset.description ?? def.description,
      emptyText: def.emptyText,
      preview: preset.preview ?? def.preview,
      // **The controls the preset does not already answer.** A preset that
      // fixes `kind: "booked"` is "a line for every booking"; offering a kind
      // select beside it invites the author to turn it into something its own
      // title contradicts. The dimension is still there — clearing the preset's
      // filter is what the general widget is for — but the row a person picked
      // by name should not immediately offer to unpick it.
      inputs: def.inputs.filter((input) => !(input.name in preset.params)),
      keywords: preset.keywords,
      aliases: RETIRED_NAMES_BY_PRESET[preset.id] ?? [],
    });
  }
  return entries;
}


