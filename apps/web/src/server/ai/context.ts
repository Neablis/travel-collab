// Typed AI context envelope builder (ADR-015: "typed context envelope, not a
// transcript dump"). Pure function — no I/O, no model calls — so every AI
// request gets a small, bounded context instead of the full board state.
//
// Two things are deliberately kept out of `tripSummary`:
//   - `activities` (the full ActivityView record, keyed by id) — the AI needs
//     only each activity's *id + title* per day (location/notes/anchors/etc.
//     are omitted), inlined here. The id matters: the planning tools
//     (MoveActivity/UpdateActivity/RemoveActivity) require the activity's UUID,
//     and each day carries its `dayId` for the same reason (MoveActivity's
//     `toDayId`). Without these the model can name an activity but has no way
//     to reference it, so it emits zero commands and nothing changes.
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

export interface TripActivitySummary {
  // The activity's UUID — what MoveActivity/UpdateActivity/RemoveActivity
  // reference. The model must copy it verbatim from here, never invent one.
  id: string;
  title: string;
}

export interface TripDaySummary {
  index: number;
  // The day's UUID — what MoveActivity's `toDayId` references.
  dayId: string;
  date: string | null;
  activities: TripActivitySummary[];
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
  // The day a `page`/`combined`-surface request is bound to, resolved from
  // `pageContext.dayRef` against `detail.days`. Absent when the surface has
  // no page context, the page isn't day-bound, or the ref doesn't resolve
  // (e.g. an out-of-range index) — same resolution rule as
  // `@tc/pages`'s `resolveDayIndex` (packages/pages/src/macros/inline.ts),
  // inlined here rather than imported since this module is otherwise free
  // of a `@tc/pages` dependency for anything but the macro catalog.
  boundDay?: { index: number; date: string | null };
}

// Resolve a day-ref against `detail.days`, mirroring
// `packages/pages/src/macros/inline.ts`'s `resolveDayIndex`.
function resolveBoundDay(detail: TripDetail, pageContext?: PageContext): AiEnvelope["boundDay"] {
  const ref = pageContext?.dayRef;
  if (!ref) return undefined;
  const index =
    ref.kind === "index"
      ? (ref.index < detail.days.length ? ref.index : null)
      : (() => {
          const idx = detail.days.findIndex((d) => d.dayId === ref.dayId);
          return idx === -1 ? null : idx;
        })();
  if (index === null) return undefined;
  return { index, date: detail.days[index]!.date };
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
      dayId: day.dayId,
      date: day.date,
      activities: day.activityIds.map((id) => ({
        id,
        title: detail.activities[id]?.title ?? "(unknown activity)",
      })),
      cost: day.costSubtotal,
    })),
  };
}

export function buildEnvelope(params: {
  detail: TripDetail;
  surface: AiSurface;
  pageContext?: PageContext;
}): AiEnvelope {
  const { detail, surface, pageContext } = params;
  const includeMacros = surface === "page" || surface === "combined";
  const boundDay = includeMacros ? resolveBoundDay(detail, pageContext) : undefined;

  return {
    surface,
    tripSummary: summarizeTrip(detail),
    ...(includeMacros ? { macros: macroCatalog() } : {}),
    tools: TOOLS_BY_SURFACE[surface],
    ...(boundDay ? { boundDay } : {}),
  };
}
