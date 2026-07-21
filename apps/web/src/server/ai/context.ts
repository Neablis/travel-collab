// Typed AI context envelope builder (ADR-015: "typed context envelope, not a
// transcript dump"). Pure function — no I/O, no model calls — so every AI
// request gets a small, bounded context instead of the full board state.
//
// Two things are deliberately kept out of `tripSummary`:
//   - `activities` (the full ActivityView record, keyed by id) — the AI only
//     needs activity *titles* per day, looked up here and inlined as strings.
//   - `conflicts` / `dismissedConflictIds` — conflict detection is a planning
//     concern surfaced through the planning tools' own results, not context
//     the model needs pre-loaded on every request.
// `members`, `backlog`, and `budget`/`budgetRemaining` are also excluded:
// none of them are needed by the page-authoring or planning tool families
// this envelope currently scopes into, and each one is either PII-adjacent
// (members) or easily re-derived by a tool call when actually needed
// (backlog, budget). If a future surface needs one, add it deliberately
// rather than restoring the whole TripDetail.
import type { PageContext, TripDetail } from "@tc/contracts";
import { macroCatalog } from "@tc/pages";

export type AiSurface = "page" | "board" | "combined";

export interface TripDaySummary {
  index: number;
  date: string | null;
  activities: string[];
  // Minor-unit integer (e.g. cents), same convention as TripDetail's
  // costSubtotal/tripCostTotal — no currency formatting here, that's a
  // presentation concern for whatever renders the model's response.
  cost: number;
}

export interface TripSummary {
  name: string;
  currency: string;
  tripCostTotal: number;
  days: TripDaySummary[];
}

export interface AiEnvelope {
  surface: AiSurface;
  tripSummary: TripSummary;
  macros?: ReturnType<typeof macroCatalog>;
  tools: string[];
}

const TOOLS_BY_SURFACE: Record<AiSurface, string[]> = {
  page: ["page"],
  board: ["planning"],
  combined: ["planning", "page"],
};

function summarizeTrip(detail: TripDetail): TripSummary {
  return {
    name: detail.name,
    currency: detail.currency,
    tripCostTotal: detail.tripCostTotal,
    days: detail.days.map((day, index) => ({
      index,
      date: day.date,
      activities: day.activityIds.map((id) => detail.activities[id]?.title ?? "(unknown activity)"),
      cost: day.costSubtotal,
    })),
  };
}

export function buildEnvelope(params: {
  detail: TripDetail;
  surface: AiSurface;
  pageContext?: PageContext;
}): AiEnvelope {
  const { detail, surface } = params;
  const includeMacros = surface === "page" || surface === "combined";

  return {
    surface,
    tripSummary: summarizeTrip(detail),
    ...(includeMacros ? { macros: macroCatalog() } : {}),
    tools: TOOLS_BY_SURFACE[surface],
  };
}
