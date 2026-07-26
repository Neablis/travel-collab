import type { TripDetail, PageContext } from "@tc/contracts";
import type { AnyMacroDef, InlinePayload, BlockPayload } from "./registry-types";
import type { MacroResult } from "./result";
import { tripName, tripDates, costTrip, costDay } from "./macros/inline";
import { itineraryDay, itineraryTrip, costsTable } from "./macros/block";

const DEFS: AnyMacroDef[] = [
  tripName, tripDates, costTrip, costDay, itineraryDay, itineraryTrip, costsTable,
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
  return def.resolve(detail, ctx, parsed.data as never);
}

export function macroCatalog(): { name: string; kind: string; description: string; emptyText: string }[] {
  return DEFS.map((d) => ({ name: d.name, kind: d.kind, description: d.description, emptyText: d.emptyText }));
}
