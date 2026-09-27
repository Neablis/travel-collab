import type { FilterDimension, WidgetShape } from "@tc/contracts";
import type { WidgetInput, WidgetSelection } from "./registry-types";
import type { WidgetEntity } from "./filters";
import { withheldFilters } from "./filters";
import { getMacro, inputsFor, primitiveCatalog, type CatalogueEntry } from "./registry";
import { PRESETS, presetCatalog, type WidgetCatalogEntry } from "./presets";

// **The assistant finds a widget by asking, not by being told every one**
// (Mitchell, 2026-09-26: *"we might need a tool to search the widgets, it will
// be too expensive to just give the AI agent all the widgets in its context
// always"*). Until then every page turn's system instruction carried
// `primitiveCatalog()` whole — ~12.9k characters, ~3.2k tokens — on every step
// of every turn, whether the turn inserted a widget or wrote a paragraph.
//
// This is the index a tool searches instead. It is data about the registry and
// nothing else, so it lives beside the registry: no trip, no clock, no I/O
// (Invariant 4). What the assistant needs on TOP of it — this trip's notebooks
// for a link, the spelling of a filter value — is the tool's, in `apps/web`.
//
// **Ranking is token matching, deterministic, and deliberately dumb.** The same
// idea the picker's `widgetMatches` uses (every word of a query is looked for
// in title, description, id, keywords and aliases), scored rather than
// filtered, because a model's query is a sentence — "add a spend by tag chart
// to Money" — and a filter that required every word to match would find
// nothing. No embeddings: the vocabulary is ~45 rows a person curated, and a
// ranking nobody can predict is one nobody can test.

/** One row of the index: a preset, or a primitive no preset of the same id stands for. */
export interface WidgetIndexEntry {
  /** What `get_widget` takes: a preset id, or a widget name. Unique across the index. */
  id: string;
  kind: "preset" | "widget";
  /** The primitive this inserts — what `insert_widget` takes as `name`. */
  widget: string;
  /** The params the preset fixes; `{}` for a primitive. */
  params: Readonly<Record<string, unknown>>;
  title: string;
  description: string;
  keywords: readonly string[];
  aliases: readonly string[];
  shape: WidgetShape;
}

/** What `search_widgets` narrows by before it ranks. Every field optional. */
export interface WidgetSearchFilters {
  shape?: WidgetShape;
  entity?: WidgetEntity;
  /** Only widgets that still accept this filter as they would be inserted. */
  acceptsFilter?: FilterDimension;
}

/**
 * One match, compact: enough to insert it correctly, and no more.
 *
 * `insert` is the whole example — pass it to `insert_widget` as it stands and
 * the widget lands. `filters` are the dimensions it still accepts as inserted
 * (a preset's own withheld ones already removed), `params` its non-filter
 * params with their allowed values (`null` for free values), and `detail` says
 * when `get_widget` has something the compact form left out.
 */
export interface WidgetMatch {
  id: string;
  title: string;
  about: string;
  shape: WidgetShape;
  insert: { name: string; params: Record<string, unknown> };
  selects?: { entity: WidgetEntity; filters: readonly FilterDimension[] };
  withheld?: WidgetSelection["withheld"];
  params?: Record<string, readonly string[] | null>;
  detail?: string;
}

export interface WidgetSearchResult {
  matches: WidgetMatch[];
  /** How many rows matched before `limit` cut the list. */
  total: number;
}

/** Everything `get_widget` knows about one row, beyond the compact match. */
export interface WidgetDetail extends WidgetMatch {
  description: string;
  preview: string;
  emptyText: string;
  /** The controls a person gets for it, with labels, choice options and defaults. */
  inputs: readonly WidgetInput[];
  /** For each field input, the paths it may name and what a person calls each. */
  fields?: Record<string, readonly { path: string; label: string }[]>;
}

export const WIDGET_SEARCH_DEFAULT_LIMIT = 6;
export const WIDGET_SEARCH_MAX_LIMIT = 12;

/**
 * The index, in a fixed order: every preset the assistant can insert, then
 * every primitive whose name is not already a preset's id.
 *
 * **Repeat presets are left out**: "A sentence for each…" inserts an authored
 * repeat, which `insert_widget` does not make (`insertRepeat` is a second
 * door, and the assistant writes sentences with `insert_text`). A widget the
 * assistant may not insert (`composable: false`) is left out for the same
 * reason `primitiveCatalog` leaves it out: a row it is shown and then refused
 * for is worse than no row.
 */
export function widgetIndex(): readonly WidgetIndexEntry[] {
  // Built once: the registry and the preset table are module constants, and a
  // search reads this on every call.
  return (INDEX ??= buildIndex());
}

let INDEX: readonly WidgetIndexEntry[] | undefined;
let CATALOGUE: ReadonlyMap<string, CatalogueEntry> | undefined;

/** The assistant's catalogue entry for one widget, from a map built once for the same reason. */
function catalogueOf(widget: string): CatalogueEntry {
  CATALOGUE ??= new Map(primitiveCatalog().map((entry) => [entry.name, entry]));
  return CATALOGUE.get(widget)!;
}

/** The index's rows, in order: presets, then the primitives no preset id stands for. */
function buildIndex(): readonly WidgetIndexEntry[] {
  const primitives = new Map(primitiveCatalog().map((entry) => [entry.name, entry]));
  const repeatIds = new Set(PRESETS.filter((preset) => preset.repeat).map((preset) => preset.id));
  const presets = presetCatalog().filter((entry) => !repeatIds.has(entry.name) && primitives.has(entry.widget));
  const presetIds = new Set(presets.map((entry) => entry.name));
  return [
    ...presets.map(presetRow),
    ...[...primitives.values()].filter((entry) => !presetIds.has(entry.name)).map(primitiveRow),
  ];
}

function presetRow(entry: WidgetCatalogEntry): WidgetIndexEntry {
  const def = getMacro(entry.widget)!;
  return {
    id: entry.name,
    kind: "preset",
    widget: entry.widget,
    params: entry.params,
    title: entry.title,
    description: entry.description,
    // The primitive's own title and name are searchable through its presets
    // too, so "Spend breakdown" still finds "Spend by tag".
    keywords: [...entry.keywords, def.title, entry.widget],
    aliases: entry.aliases,
    shape: entry.shape,
  };
}

function primitiveRow(entry: CatalogueEntry): WidgetIndexEntry {
  return {
    id: entry.name,
    kind: "widget",
    widget: entry.name,
    params: {},
    title: entry.title,
    description: entry.description,
    keywords: [],
    aliases: [],
    shape: entry.shape,
  };
}

// Words that carry no meaning about WHICH widget: the verbs of asking and the
// glue between nouns. "by" is one, deliberately — "spend by tag" is found by
// "spend" and "tag", and "by" would otherwise score every "Spend by …" alike.
const STOP_WORDS = new Set([
  "a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "at", "by", "with", "from", "into", "onto",
  "my", "our", "me", "i", "we", "it", "this", "that", "these", "those", "some", "please", "can", "you",
  "add", "insert", "put", "show", "make", "want", "need", "give", "widget",
]);

/**
 * A word as the index compares it: lower case, with a plural's `s` (or `ies`)
 * taken off, so "costs" meets "cost" and "cities" meets "city". Crude on
 * purpose — the vocabulary is small, curated and English, and a stemmer is a
 * dependency whose answers nobody here could predict.
 */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
}

/** The query's words, less the stop words — unless that leaves nothing. */
function queryTokens(query: string): string[] {
  const all = wordsOf(query);
  const meaningful = all.filter((word) => !STOP_WORDS.has(word));
  return [...new Set(meaningful.length > 0 ? meaningful : all)];
}

// How much a word is worth by where it matched. A title is what the widget is
// called and an id is what it IS, so both outrank a keyword; a description is
// prose and matches everything a little, so it counts least.
const WEIGHTS = { id: 6, title: 5, keyword: 4, alias: 4, description: 1 } as const;

interface Fields {
  sets: readonly (readonly [Set<string>, number])[];
  phrases: readonly string[];
}

function fieldsOf(entry: WidgetIndexEntry): Fields {
  return {
    sets: [
      [new Set([...wordsOf(entry.id), ...wordsOf(entry.widget)]), WEIGHTS.id],
      [new Set(wordsOf(entry.title)), WEIGHTS.title],
      [new Set(entry.keywords.flatMap(wordsOf)), WEIGHTS.keyword],
      [new Set(entry.aliases.flatMap(wordsOf)), WEIGHTS.alias],
      [new Set(wordsOf(entry.description)), WEIGHTS.description],
    ],
    // A keyword of several words ("to book", "per day") is worth more as a
    // phrase than as its words, which a stop word may have removed.
    phrases: entry.keywords.filter((keyword) => keyword.includes(" ")).map((keyword) => wordsOf(keyword).join(" ")),
  };
}

/**
 * How well one row matches, and how many of the query's words it matched.
 *
 * Per word, the best field it appears in; a word of four letters or more that
 * only STARTS a word in a field ("burn" in "burndown") earns half. Plus a
 * bonus for the query being the row's id, widget name or title outright, and
 * for each multi-word keyword the query contains.
 */
export function scoreWidget(entry: WidgetIndexEntry, query: string): { score: number; matched: number } {
  const tokens = queryTokens(query);
  const { sets, phrases } = fieldsOf(entry);
  let score = 0;
  let matched = 0;
  for (const token of tokens) {
    let best = 0;
    for (const [words, weight] of sets) {
      if (words.has(token)) best = Math.max(best, weight);
      else if (token.length >= 4 && [...words].some((word) => word.startsWith(token))) {
        best = Math.max(best, Math.floor(weight / 2));
      }
    }
    if (best > 0) matched += 1;
    score += best;
  }
  const whole = query.trim().toLowerCase();
  if (whole === entry.id || whole === entry.widget) score += 20;
  if (whole === entry.title.toLowerCase()) score += 10;
  const normalised = ` ${wordsOf(query).join(" ")} `;
  for (const phrase of phrases) if (normalised.includes(` ${phrase} `)) score += 3;
  return { score, matched };
}

/** Whether a row survives the filters, read off the widget as it would be inserted. */
function passes(entry: WidgetIndexEntry, filters: WidgetSearchFilters): boolean {
  if (filters.shape !== undefined && entry.shape !== filters.shape) return false;
  const selection = getMacro(entry.widget)?.selection;
  if (filters.entity !== undefined && selection?.entity !== filters.entity) return false;
  if (filters.acceptsFilter !== undefined && !acceptedFilters(entry).includes(filters.acceptsFilter)) return false;
  return true;
}

/** The dimensions a row still accepts once its preset params are in: its selection less what they withhold. */
function acceptedFilters(entry: WidgetIndexEntry): readonly FilterDimension[] {
  const selection = getMacro(entry.widget)?.selection;
  if (!selection) return [];
  const withheld = new Set(withheldFilters(selection, entry.params));
  return selection.filters.filter((dimension) => !withheld.has(dimension));
}

/**
 * Search the index. An empty query lists every row the filters let through,
 * in index order; otherwise rows matching no word are dropped and the rest are
 * ranked by score, then by how many words they matched, then by index order —
 * so the same query always answers the same list.
 */
export function searchWidgets(
  query: string,
  filters: WidgetSearchFilters = {},
  limit: number = WIDGET_SEARCH_DEFAULT_LIMIT,
): WidgetSearchResult {
  const cap = Math.max(1, Math.min(Math.floor(limit), WIDGET_SEARCH_MAX_LIMIT));
  const rows = widgetIndex().filter((entry) => passes(entry, filters));
  const ranked =
    queryTokens(query).length === 0
      ? rows
      : rows
          .map((entry, index) => ({ entry, index, ...scoreWidget(entry, query) }))
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score || b.matched - a.matched || a.index - b.index)
          .map((row) => row.entry);
  return { matches: ranked.slice(0, cap).map(matchOf), total: ranked.length };
}

/** One row by its id — a preset id or a widget name — in full. `null` when there is no such row. */
export function widgetDetail(id: string): WidgetDetail | null {
  const entry = widgetIndex().find((row) => row.id === id) ?? widgetIndex().find((row) => row.widget === id);
  if (!entry) return null;
  const def = getMacro(entry.widget)!;
  const catalogue = catalogueOf(entry.widget);
  const preset = entry.kind === "preset" ? presetCatalog().find((row) => row.name === entry.id) : undefined;
  return {
    ...matchOf(entry),
    description: entry.description,
    preview: preset?.preview ?? def.preview,
    emptyText: def.emptyText,
    inputs: inputsFor(entry.widget, entry.params),
    ...(catalogue.fields ? { fields: catalogue.fields } : {}),
  };
}

/**
 * A placeholder for an input a widget cannot usefully land without, by input
 * TYPE — never by widget name, so a third link-like widget needs no edit here.
 *
 * A target placeholder is a real target (the Plan tab, which names no id), so
 * the example inserts as it stands; an address placeholder is deliberately NOT
 * an address, so a model that copies it verbatim is refused rather than
 * planting a link nobody asked for.
 */
const PLACEHOLDER_BY_TYPE: Partial<Record<WidgetInput["type"], unknown>> = {
  target: { kind: "view", view: "Plan" },
  url: "<an http(s) address the user typed>",
};

// What `get_widget` has that the compact match does not, by input type.
const DETAIL_BY_TYPE: Partial<Record<WidgetInput["type"], string>> = {
  field: "call get_widget for the field paths it takes",
  target: "call get_widget for this trip's notebooks, days and tabs it can link to",
};

function matchOf(entry: WidgetIndexEntry): WidgetMatch {
  const def = getMacro(entry.widget)!;
  const catalogue = catalogueOf(entry.widget);
  const inputs = inputsFor(entry.widget, entry.params);
  const insertParams: Record<string, unknown> = { ...entry.params };
  for (const input of inputs) {
    const placeholder = PLACEHOLDER_BY_TYPE[input.type];
    if (placeholder !== undefined && !(input.name in insertParams)) insertParams[input.name] = placeholder;
  }
  const fieldInputs = new Set(inputs.filter((input) => input.type === "field").map((input) => input.name));
  // A field input's allowed list is the manifest — dozens of paths — so the
  // compact form names the param and leaves the list to `get_widget`.
  const params = Object.fromEntries(
    Object.entries(catalogue.params).map(([name, values]) => [name, fieldInputs.has(name) ? null : values]),
  );
  const details = [...new Set(inputs.map((input) => DETAIL_BY_TYPE[input.type]).filter((d): d is string => !!d))];
  return {
    id: entry.id,
    title: entry.title,
    about: firstSentence(entry.description),
    shape: entry.shape,
    insert: { name: entry.widget, params: insertParams },
    ...(def.selection ? { selects: { entity: def.selection.entity, filters: acceptedFilters(entry) } } : {}),
    ...(def.selection?.withheld ? { withheld: def.selection.withheld } : {}),
    ...(Object.keys(params).length > 0 ? { params } : {}),
    ...(details.length > 0 ? { detail: details.join("; ") } : {}),
  };
}

/** The description's first sentence — the "one line" a match carries. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}
