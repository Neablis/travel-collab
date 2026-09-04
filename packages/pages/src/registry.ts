import type { TripDetail, PageContext, WidgetShape } from "@tc/contracts";
import type { AnyMacroDef, InlinePayload, BlockPayload, Rendered, WidgetContext, WidgetInput } from "./registry-types";
import type { MacroResult } from "./result";
import { tripName, tripDates, costTrip, costDay } from "./macros/inline";
import { itineraryDay, itineraryTrip, costsTable } from "./macros/block";
import { accountName, accountHomeAirport } from "./macros/account";
import { dayDate, dayCity, dayWindow, budgetRemaining } from "./macros/day";

const DEFS: AnyMacroDef[] = [
  tripName, tripDates, costTrip, costDay, itineraryDay, itineraryTrip, costsTable,
  accountName, accountHomeAirport,
  dayDate, dayCity, dayWindow, budgetRemaining,
] as unknown as AnyMacroDef[];

export const MACRO_REGISTRY: Record<string, AnyMacroDef> = Object.fromEntries(DEFS.map((d) => [d.name, d]));
export const MACRO_NAMES: readonly string[] = DEFS.map((d) => d.name);

export function getMacro(name: string): AnyMacroDef | undefined {
  return MACRO_REGISTRY[name];
}

export type ResolveOutcome =
  | MacroResult<InlinePayload | BlockPayload>
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
  | { status: "unbound"; needs: "day" | "trip" }
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
  return DEFS.map((d) => ({
    name: d.name, title: d.title, shape: d.shape,
    description: d.description, emptyText: d.emptyText, preview: d.preview,
    // What the widget takes, so the sidebar can say so BEFORE a click rather
    // than leaving a person to insert one and discover it wants a day (M14's
    // gate: "a mono line naming what it takes"). The registry already knew;
    // `macroCatalog` was the only thing dropping it on the floor.
    inputs: d.inputs,
  }));
}
