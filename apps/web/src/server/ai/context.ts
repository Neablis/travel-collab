// The shared AI context module: what a turn is ABOUT (`AskScope`), and the
// derived, model-safe views of a trip that more than one tool family reads.
//
// It used to build the command endpoint's `Context: {…}` envelope as well.
// That went with `/ai` (ADR-033 Decision 4): `/ask` hands the model READ TOOLS
// instead of a pre-rendered summary, so a turn asks for the day it needs
// rather than paying for every day on every request.
//
// What survived the envelope, and why:
//   - `activeConflicts` / `conflictsOnDay` — the stable, human-referenceable
//     conflict `ref` numbering. The raw `Conflict.id` is compound and embeds
//     UUIDs the model must never copy, and this is the SINGLE source of that
//     numbering: both the read tools and `batchResolver`'s `conflictRef`
//     resolution read it, so the number the model is shown and the id the
//     server resolves it back to cannot drift.
import type { TripDetail } from "@tc/contracts";

// Every surface a model is selected for, and there is one: `/ask` is the only
// AI entry point (ADR-033 Decision 1). `AiCommandSurface` — the `page` /
// `board` / `combined` union the command endpoint chose a tool set from — went
// with that endpoint.
//
// Kept as a one-member union rather than inlined because it is what
// `selectAiModel({ surface, userId })` decides against: ADR-019's amendment
// makes entitlement and model choice per-surface, so a second surface lands
// here rather than as a signature change at every call site.
export type AiSurface = "ask";

/**
 * What one /ask turn is about — the narrowing the client asked for, and (for
 * `page`) the thing the server then has to VERIFY.
 *
 * `dayIndex` is 0-based, matching `TripDetail.days`; the 1-based day NUMBER is
 * a presentation concern that belongs at the tool boundary, where the model
 * reads it (readTools.ts).
 *
 * `pageId` is the one member that names a row. It is a CLAIM, never a fact:
 * `handleAskRequest` resolves it server-side — the page exists, it belongs to
 * THIS trip, and the actor may edit it — before any page tool is offered
 * (ADR-033 Decision 2). A scope the server cannot resolve is refused; it never
 * falls back to a wider tool set.
 */
export type AskScope =
  | { kind: "trip" }
  | { kind: "day"; dayIndex: number }
  | { kind: "page"; pageId: string };

// How the scope is written into the /ask system instruction, and read back out
// of it.
//
// The instruction is the only channel that reaches BOTH a real model and the
// simulated one: `simulatedModel("ask")` is handed a prompt and a tool set and
// nothing else, so without this it cannot tell a day-scoped turn from a
// trip-scoped one and cannot decide whether to call `read_day`. Encoding it as
// one machine-readable line keeps the writer and the reader in one module, so
// they cannot drift apart. A round-trip test enforces that.
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
      const parsed = JSON.parse(line.slice(ASK_SCOPE_PREFIX.length)) as {
        kind?: unknown;
        dayIndex?: unknown;
        pageId?: unknown;
      };
      if (parsed?.kind === "day" && Number.isInteger(parsed.dayIndex)) {
        return { kind: "day", dayIndex: parsed.dayIndex as number };
      }
      // A page-scoped turn composes instead of answering, so the simulated
      // model has to be able to tell one from a question. The id is echoed
      // back unread: this parser's job is which turn, not which page — the
      // page was resolved server-side before the line was ever written.
      if (parsed?.kind === "page" && typeof parsed.pageId === "string" && parsed.pageId !== "") {
        return { kind: "page", pageId: parsed.pageId };
      }
    } catch {
      // Malformed line — fall through to the trip-wide reading.
    }
  }
  return { kind: "trip" };
}

// A single active conflict, in the stable human-referenceable form the model
// sees. `ref` is 1-based and stable within one reading of the trip; it is what
// DismissConflict's `conflictRef` resolves against. The raw content-derived
// `id` (which embeds UUIDs) is deliberately NOT exposed here.
export interface AiConflictSummary {
  ref: number;
  kind: string;
  description: string;
}

// The active (non-dismissed) conflicts, in the same order the resolver indexes
// them — the SINGLE source of truth for conflict `ref` numbering, so the number
// the model is shown and the id the resolver maps it back to can never drift.
// `detail.conflicts` is already sorted deterministically by `detectConflicts`;
// filtering by `dismissedConflictIds` preserves that order. The returned `id`
// is for the resolver only; every caller that shows a conflict strips it.
export function activeConflicts(detail: TripDetail): (AiConflictSummary & { id: string })[] {
  const dismissed = new Set(detail.dismissedConflictIds);
  return detail.conflicts
    .filter((c) => !dismissed.has(c.id))
    .map((c, i) => ({ ref: i + 1, id: c.id, kind: c.kind, description: c.description }));
}

/**
 * The active conflicts that touch ONE day, keeping the trip-wide `ref` numbers
 * `activeConflicts` assigns — a conflict is "conflict 2" wherever it is read,
 * or a day-scoped answer and a trip-scoped one would name the same clash by two
 * different numbers.
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
