import type { TripDetail, PageContext } from "@tc/contracts";
import type { AnyMacroDef, InlinePayload, BlockPayload, Rendered, WidgetContext } from "./registry-types";
import type { MacroResult } from "./result";
import { tripName, tripDates, costTrip, costDay } from "./macros/inline";
import { itineraryDay, itineraryTrip, costsTable } from "./macros/block";
import { accountName, accountHomeAirport } from "./macros/account";

const DEFS: AnyMacroDef[] = [
  tripName, tripDates, costTrip, costDay, itineraryDay, itineraryTrip, costsTable,
  accountName, accountHomeAirport,
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
  | { status: "unbound"; needs: "day" }
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

export function macroCatalog(): { name: string; kind: string; description: string; emptyText: string }[] {
  return DEFS.map((d) => ({ name: d.name, kind: d.kind, description: d.description, emptyText: d.emptyText }));
}
