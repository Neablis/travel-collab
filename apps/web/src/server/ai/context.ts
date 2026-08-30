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
//   - the full `conflicts` / `dismissedConflictIds` records — the raw
//     Conflict shape carries a compound, UUID-embedding `id` the model must
//     never copy. Instead, `AiEnvelope.conflicts` (planning surfaces only)
//     surfaces the ACTIVE (non-dismissed) conflicts in a stable,
//     human-referenceable form — a 1-based `ref` + kind + description — so
//     DismissConflict can name one by its number (`conflictRef`), resolved
//     server-side back to its real id (see `activeConflicts`). Without this
//     the model has no id to reference and every dismiss attempt fails.
// `members`, `backlog`, and `budget`/`budgetRemaining` are also excluded:
// none of them are needed by the page-authoring or planning tool families
// this envelope currently scopes into, and each one is either PII-adjacent
// (members) or easily re-derived by a tool call when actually needed
// (backlog, budget). If a future surface needs one, add it deliberately
// rather than restoring the whole TripDetail.
import type { PageContext, TripDetail } from "@tc/contracts";
import { macroCatalog } from "@tc/pages";

// The surfaces that BUILD a context envelope and execute commands. Every one
// of them writes: `page` authors Notebook content, `board`/`combined` apply a
// planning batch.
export type AiCommandSurface = "page" | "board" | "combined";

// Every surface a model is selected for. `ask` (M16, ADR-022) is the read-only
// one: it answers a question through read tools instead of composing an
// envelope, so it is deliberately absent from `buildEnvelope` and from every
// `Record<AiCommandSurface, …>` below. It exists in this union because
// `selectAiModel({ surface })` and `simulatedModel(surface)` are shared by both
// entry points — one chokepoint, one flag, one kill switch (ADR-019).
export type AiSurface = AiCommandSurface | "ask";

// What one /ask turn is about. `dayIndex` is 0-based, matching
// `TripDetail.days` — the 1-based day NUMBER is a presentation concern that
// belongs at the tool boundary, where the model reads it (readTools.ts).
export type AskScope = { kind: "trip" } | { kind: "day"; dayIndex: number };

// How the scope is written into the /ask system instruction, and read back out
// of it.
//
// The instruction is the only channel that reaches BOTH a real model and the
// simulated one: `simulatedModel("ask")` is handed a prompt and a tool set and
// nothing else, so without this it cannot tell a day-scoped turn from a
// trip-scoped one and cannot decide whether to call `read_day`. Encoding it as
// one machine-readable line — the same trick `handleAiRequest`'s
// `Context: {…}` line already uses — keeps the writer and the reader in one
// module, so they cannot drift apart. A round-trip test enforces that.
// Exported so tests building a malformed scope line (context.test.ts) attach
// it to the real prefix instead of a hard-coded copy — otherwise the prefix
// could change here without those tests noticing they'd stopped reaching the
// JSON.parse catch branch they claim to cover.
export const ASK_SCOPE_PREFIX = "Scope: ";

export function askScopeLine(scope: AskScope): string {
  return `${ASK_SCOPE_PREFIX}${JSON.stringify(scope)}`;
}

// Total: anything that is not a well-formed scope line reads as the whole
// trip, which is the wider, safer reading — a narrowing that silently failed
// would answer about one day and say nothing about having done so.
export function parseAskScope(instructions: string): AskScope {
  for (const line of instructions.split("\n")) {
    if (!line.startsWith(ASK_SCOPE_PREFIX)) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(ASK_SCOPE_PREFIX.length));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { kind?: unknown }).kind === "day" &&
        Number.isInteger((parsed as { dayIndex?: unknown }).dayIndex)
      ) {
        return { kind: "day", dayIndex: (parsed as { dayIndex: number }).dayIndex };
      }
    } catch {
      // Malformed line — fall through to the trip-wide reading.
    }
  }
  return { kind: "trip" };
}

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

// A single active conflict, in the stable human-referenceable form the model
// sees. `ref` is 1-based and stable within one envelope; it is what
// DismissConflict's `conflictRef` resolves against. The raw content-derived
// `id` (which embeds UUIDs) is deliberately NOT exposed here.
export interface AiConflictSummary {
  ref: number;
  kind: string;
  description: string;
}

// The active (non-dismissed) conflicts, in the same order the resolver indexes
// them — the SINGLE source of truth for conflict `ref` numbering, so the
// envelope the model reads and the resolver that maps a `ref` back to an id can
// never drift. `detail.conflicts` is already sorted deterministically by
// `detectConflicts`; filtering by `dismissedConflictIds` preserves that order.
// The returned `id` is for the resolver only; the envelope strips it.
export function activeConflicts(detail: TripDetail): (AiConflictSummary & { id: string })[] {
  const dismissed = new Set(detail.dismissedConflictIds);
  return detail.conflicts
    .filter((c) => !dismissed.has(c.id))
    .map((c, i) => ({ ref: i + 1, id: c.id, kind: c.kind, description: c.description }));
}

/**
 * The active conflicts that touch ONE day, keeping the trip-wide `ref` numbers
 * `activeConflicts` assigns — a conflict is "conflict 2" wherever it is read,
 * or a day-scoped answer and the command envelope would name the same clash by
 * two different numbers.
 *
 * Membership is `subjects` intersecting the day's `activityIds`, which is
 * exactly the filter `suggestedQuestions.ts` applies to decide whether to OFFER
 * "there's 1 conflict on day N — how should I fix it?". The two agree by
 * construction, which is the point: the chip existed and the answer did not
 * (final branch review, 2026-08-29, finding 1).
 *
 * The over-budget conflict's subject is the tripId, so it belongs to no day and
 * never appears here. That is right — a budget overrun is not a fact about
 * day 3 — and it is also what keeps a day-scoped answer from naming days it was
 * not asked about (M16's gate).
 */
export function conflictsOnDay(detail: TripDetail, dayIndex: number): AiConflictSummary[] {
  const day = detail.days[dayIndex];
  if (!day) return [];
  const onThisDay = new Set(day.activityIds);
  const subjectsById = new Map(detail.conflicts.map((c) => [c.id, c.subjects]));
  return activeConflicts(detail)
    .filter(({ id }) => (subjectsById.get(id) ?? []).some((s) => onThisDay.has(s)))
    .map(({ id: _id, ...rest }) => rest);
}

export interface AiEnvelope {
  surface: AiCommandSurface;
  tripSummary: TripSummary;
  macros?: ReturnType<typeof macroCatalog>;
  // Active (non-dismissed) conflicts the model can dismiss by `ref`, present
  // only on planning surfaces (board/combined) and only when there are any.
  // Kept out of `tripSummary` on purpose — it is a planning affordance, not
  // part of the trip's shape. See `activeConflicts`.
  conflicts?: AiConflictSummary[];
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

const TOOLS_BY_SURFACE: Record<AiCommandSurface, string[]> = {
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
  surface: AiCommandSurface;
  pageContext?: PageContext;
}): AiEnvelope {
  const { detail, surface, pageContext } = params;
  const includeMacros = surface === "page" || surface === "combined";
  const includePlanning = surface === "board" || surface === "combined";
  const boundDay = includeMacros ? resolveBoundDay(detail, pageContext) : undefined;
  // Strip the internal `id` — the model references conflicts by `ref` only.
  const conflicts = includePlanning
    ? activeConflicts(detail).map(({ id: _id, ...rest }) => rest)
    : [];

  return {
    surface,
    tripSummary: summarizeTrip(detail),
    ...(includeMacros ? { macros: macroCatalog() } : {}),
    ...(conflicts.length > 0 ? { conflicts } : {}),
    tools: TOOLS_BY_SURFACE[surface],
    ...(boundDay ? { boundDay } : {}),
  };
}
