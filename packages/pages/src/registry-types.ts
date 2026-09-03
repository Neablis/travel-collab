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

// What a widget TAKES, declared so a UI can choose a control for it
// (ADR-035 decision 2, SPEC §18). A Zod schema says a param is a string; it
// cannot say the string is a day, a person or a tag — so `params` alone cannot
// tell the insert sheet which control to render. Hence a second, purely
// descriptive field.
//
// `type` is what the control is chosen from, so a NEW widget taking a day needs
// no new UI. Five types, per §18's table:
//   day    → one day select        "Day 6 · Hakone"
//   days   → from / through        "Day 6 – Day 8", or "Day 6" when equal
//   person → who                   "Priya"
//   tags   → every stop, or one    "meal stops"
//   trip   → which trip            the trip name
//
// `name` is not decoration: it must be a key the macro's OWN `params` schema
// accepts, or the widget declares a binding the validator ignores. That
// correspondence is enforced by a registry-wide test rather than by convention.
export type WidgetInput =
  | { name: string; type: "day"; label: string }
  | { name: string; type: "days"; label: string }
  // `person` is declared because §18 declares it, and NOTHING MAY USE IT YET:
  // nothing links an activity to a person — no `assignee`, `paidBy`,
  // `participant` or `share` on `ActivityView`. The two widgets that wanted it
  // (`w-person`, `w-personline`) were deferred out of M14 on 2026-09-03 for
  // exactly that reason. A widget declaring this input would get a control that
  // resolves against data that does not exist. The field arrives with M13's
  // `add-stop-who` / M19 link 3; until then this member is vocabulary, not a
  // capability.
  | { name: string; type: "person"; label: string }
  | { name: string; type: "tags"; label: string }
  | { name: string; type: "trip"; label: string };

export interface MacroDef<P, T> {
  name: string;                    // "cost.trip", "itinerary.day"
  kind: MacroKind;                 // "inline" | "block"
  params: z.ZodType<P>;            // per-macro param schema (registry owns it)
  // What the widget takes. REQUIRED, and `[]` is a real answer meaning "binds
  // nothing, inserts immediately" (ADR-035 decision 2). Optional would collapse
  // that into "not declared yet", which the insert sheet has to tell apart —
  // and required means the compiler names every entry that forgot.
  inputs: readonly WidgetInput[];
  description: string;             // human- AND machine-readable (AI + autocomplete)
  emptyText: string;               // declarative empty-state copy
  resolve(detail: TripDetail, ctx: PageContext, params: P): MacroResult<T>;
}

// Existentially-typed entry for the registry map.
export type AnyMacroDef = MacroDef<Record<string, unknown>, InlinePayload | BlockPayload>;
