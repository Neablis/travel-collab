import type { TripDetail, PageContext, WidgetShape } from "@tc/contracts";
import type { AnyMacroDef, InlinePayload, BlockPayload, RepeatPayload, Rendered, WidgetContext, WidgetInput } from "./registry-types";
import type { MacroResult, UnboundNeeds } from "./result";
import { tripName, tripDates, costTrip, costDay } from "./macros/inline";
import { itineraryDay, itineraryTrip, costsTable } from "./macros/block";
import { accountName, accountHomeAirport } from "./macros/account";
import { dayDate, dayCity, dayWindow, budgetRemaining } from "./macros/day";
import { dayLine, cityLine, bookingLine, stopLine } from "./macros/repeat";
import { cost, count, dates, hours, city } from "./macros/primitives/single";
import { dayDetail, cityDetail } from "./macros/primitives/block";
import { dayRows, cityRows, stopRows, costRows } from "./macros/primitives/rows";

// **The seventeen named widgets.** ADR-039's opening table shows four pairs of
// them that are the same widget written twice — `cost.day`/`cost.trip` differ
// only by whether a day filter is set — and spec §8 step 3 replaces the lot with
// `(primitive, params, title, keywords)` preset rows over the primitives below.
// Until that migration lands they are what documents store and what the picker
// browses, so they stay registered and stay catalogued.
const NAMED_DEFS: AnyMacroDef[] = [
  tripName, tripDates, costTrip, costDay, itineraryDay, itineraryTrip, costsTable,
  accountName, accountHomeAirport,
  dayDate, dayCity, dayWindow, budgetRemaining,
  dayLine, cityLine, bookingLine, stopLine,
] as unknown as AnyMacroDef[];

// **The eleven primitives** (ADR-039 decision 1; spec §1's table minus
// `attribute`, which is step 2 of the order of work). Each is `entity + filters
// + shape` and declares all three, so what used to be a cross product typed out
// by hand is now a selection anyone can narrow.
//
// They are registered — `insertWidget`, `resolveMacro` and `renderMacro` all
// reach them, and every registry-wide test sweeps them — and they are
// deliberately NOT in `macroCatalog()` yet. That is ADR-039 decision 5 rather
// than a staging trick: *"the combination space is therefore not the browsable
// list; the preset list is"*. The presets arrive in step 3 with the migration
// that retires the seventeen above, and the catalogue becomes their table.
const PRIMITIVE_DEFS: AnyMacroDef[] = [
  cost, count, dates, hours, city,
  dayDetail, cityDetail,
  dayRows, cityRows, stopRows, costRows,
] as unknown as AnyMacroDef[];

const DEFS: AnyMacroDef[] = [...NAMED_DEFS, ...PRIMITIVE_DEFS];

export const MACRO_REGISTRY: Record<string, AnyMacroDef> = Object.fromEntries(DEFS.map((d) => [d.name, d]));
export const MACRO_NAMES: readonly string[] = DEFS.map((d) => d.name);

/**
 * The names of the registered primitives — the defs that declare a `selection`.
 *
 * Derived from the declaration rather than listed a second time, so a primitive
 * added without one is simply not a primitive and the legality tests say so,
 * instead of a hand-kept list drifting from the registry it describes.
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

// The catalogue the AI tools and the insert sidebar read. `shape` replaces the
// old `kind` (ADR-037 decision 1), and `title`/`preview` are here because the
// sidebar lists a widget by the name a person calls it and shows a sample.
export function macroCatalog(): {
  name: string; title: string; shape: WidgetShape; description: string; emptyText: string;
  preview: string; inputs: readonly WidgetInput[];
}[] {
  // `NAMED_DEFS`, not `DEFS`. The catalogue is the BROWSABLE list — the slash
  // menu and the insert sidebar both read it — and ADR-039 decision 5 says the
  // browsable list is the presets, not the combination space behind them. The
  // primitives are registered and reachable; what they do not yet have is a
  // curated set of names worth showing, and inventing one here would be writing
  // step 3's preset table in the wrong file.
  return NAMED_DEFS.map((d) => ({
    name: d.name, title: d.title, shape: d.shape,
    description: d.description, emptyText: d.emptyText, preview: d.preview,
    // What the widget takes, so the sidebar can say so BEFORE a click rather
    // than leaving a person to insert one and discover it wants a day (M14's
    // gate: "a mono line naming what it takes"). The registry already knew;
    // `macroCatalog` was the only thing dropping it on the floor.
    inputs: d.inputs,
  }));
}
