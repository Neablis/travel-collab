import type { z } from "zod";
import type { TripDetail, PageContext, MacroKind } from "@tc/contracts";
import type { MacroResult } from "./result";

// Inline payloads are display-ready strings; block payloads are structured data
// the renderer turns into a component (NOT markup — the C-era swap point).
export type InlinePayload = string;
export interface ItineraryDayPayload { dayId: string; date: string | null; activities: { title: string; timeWindow: string | null; cost: string | null }[]; }
export interface ItineraryTripPayload { days: ItineraryDayPayload[]; }
export interface CostRow { label: string; amount: string; }
export interface CostsTablePayload { rows: CostRow[]; total: string; }
export type BlockPayload = ItineraryDayPayload | ItineraryTripPayload | CostsTablePayload;

export interface MacroDef<P, T> {
  name: string;                    // "cost.trip", "itinerary.day"
  kind: MacroKind;                 // "inline" | "block"
  params: z.ZodType<P>;            // per-macro param schema (registry owns it)
  description: string;             // human- AND machine-readable (AI + autocomplete)
  emptyText: string;               // declarative empty-state copy
  resolve(detail: TripDetail, ctx: PageContext, params: P): MacroResult<T>;
}

// Existentially-typed entry for the registry map.
export type AnyMacroDef = MacroDef<Record<string, unknown>, InlinePayload | BlockPayload>;
