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
import type { TimeFormat, TripDetail, TripGlobals } from "@tc/contracts";
import { clockIn, isKnownZone, timedStops, tripNow, type TripNowStop, type TripPhase } from "@tc/pages";
import type { PlaybookDiscoverSearch } from "./admission";
import { data, rule, untrusted, type PromptBlock } from "./prompt";

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
  | { kind: "page"; pageId: string }
  // M45: every trip the asker travelled on, and no one trip. It names no row,
  // so there is nothing to verify; the route it arrives on is what decides it.
  | { kind: "account" }
  // M45 D9: one of the playbook pages, and what is on it. A day's id is a
  // claim, resolved like `pageId` (admission's `resolveSurface`).
  | { kind: "playbook"; page: PlaybookPage };

/**
 * Which playbook page a turn is asked on (M45 D9). `day` is the shared-day
 * page, which shows one playbook day or a playbook of several (its row says
 * which); the other three are lists, each as far as the reader has paged it:
 * Discover with its whole search (tab, sort, filters, cursor), one city's
 * page, and one tag's, in a city's page (`city` is its slug) or across the
 * library, each at its `?page=N`.
 */
export type PlaybookPage =
  | { kind: "day"; savedDayId: string }
  | { kind: "discover"; search: PlaybookDiscoverSearch }
  | { kind: "city"; slug: string; page: number }
  | { kind: "tag"; tag: string; city: string | null; page: number };

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

/** The `Scope: {…}` line that carries an ask's day or trip scope into the model's instructions. */
export function askScopeLine(scope: AskScope): string {
  return `${ASK_SCOPE_PREFIX}${JSON.stringify(scope)}`;
}

// Total: anything that is not a well-formed scope line reads as the whole
// trip, which is the wider, safer reading — a narrowing that silently failed
// would answer about one day and say nothing about having done so.
/** The scope named by the `Scope:` line in `instructions`, or the whole trip when there is none or it does not parse. */
export function parseAskScope(instructions: string): AskScope {
  for (const line of instructions.split("\n")) {
    if (!line.startsWith(ASK_SCOPE_PREFIX)) continue;
    try {
      const parsed = JSON.parse(line.slice(ASK_SCOPE_PREFIX.length)) as {
        kind?: unknown;
        dayIndex?: unknown;
        pageId?: unknown;
        page?: unknown;
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
      // An account turn has no trip to fall back to, and the simulated model
      // must not answer it with `read_trip`, which it is not handed.
      if (parsed?.kind === "account") return { kind: "account" };
      // Nor has a playbook turn. Its page was verified before the line was
      // written, so it is echoed back as it stands.
      if (parsed?.kind === "playbook" && typeof parsed.page === "object" && parsed.page !== null) {
        return { kind: "playbook", page: parsed.page as PlaybookPage };
      }
    } catch {
      // Malformed line — fall through to the trip-wide reading.
    }
  }
  return { kind: "trip" };
}

/**
 * The instruction line that tells the model which clock the asker reads, so an
 * answer says "2:30 pm" to one person and "14:30" to another — the same
 * `UserPreferences.timeFormat` the board and the notebook print with.
 *
 * Needed because nothing else would do it: `read_day` hands the model stored
 * `HH:mm`, which is 24-hour whatever anybody chose, and a model copies the
 * form it was shown. Tool INPUT stays 24-hour either way — a stop's time is
 * stored `HH:mm` and the write tools validate that shape — so the line says so,
 * rather than letting "write times as 2 pm" leak into a `timeWindow`.
 *
 * Built from the enum alone, never from anything a person typed, so it is a
 * rule rather than a `data` block.
 */
export function clockTimesLine(format: TimeFormat): string {
  return format === "24h"
    ? 'Write any clock time in your answer on the 24-hour clock, the way this person reads times: "09:30", "14:00", "00:00" for midnight. Times you pass to a tool are 24-hour HH:mm as well.'
    : 'Write any clock time in your answer on the 12-hour clock, the way this person reads times: "9:30 am", "2 pm", "12 am" for midnight — never "14:00". The tools give times as 24-hour HH:mm because that is how they are stored; convert them when you write them to the person, and keep passing HH:mm to a tool.';
}

/**
 * **Where the trip is as the turn starts** (M52 decision 14a), read once with
 * `tripNow` so the instruction, the tool set and `find_places_near_now` agree
 * on one instant. The stops are `tripNow`'s; `passed` and `city` are what
 * `find_places_near_now` falls back on when nothing is under way.
 */
export interface TurnNow {
  phase: TripPhase;
  /** Today's day, 0-based, while the trip is under way. */
  dayIndex: number | null;
  /** The date and `HH:mm` on today's clock, or the first day's before the trip, and that clock's zone. */
  local: { date: string; time: string; timeZone: string };
  current: TripNowStop | null;
  next: TripNowStop | null;
  /** The last of today's stops whose window has closed. */
  passed: TripNowStop | null;
  /**
   * Today's city, and where it is when a stop in it has coordinates
   * (`TripGlobalsDay.weatherPlace`, so the name and the point are one stop's).
   */
  city: { name: string; lat: number | null; lng: number | null } | null;
}

/**
 * The trip at `at`, on the server. A day without a zone of its own runs on the
 * asker's (`deviceZone`, the zone their client sent), as Home's badge does
 * (ADR-080 decision 1). A turn that brought none runs on the trip's (its first
 * day that has one), and on UTC when no stop anywhere has coordinates. A zone this runtime does not know is passed over, as
 * `tripNow` passes it over, rather than failing the turn.
 */
export function turnNowOf(
  detail: TripDetail,
  globals: TripGlobals | null,
  at: number,
  deviceZone: string | null = null,
): TurnNow {
  const known = (zone: string | null | undefined): zone is string => zone != null && isKnownZone(zone);
  const fallback = known(deviceZone) ? deviceZone : (globals?.days.map((day) => day.timeZone).find(known) ?? "UTC");
  const now = tripNow(detail, globals, { at, deviceZone: fallback });
  const dayIndex = now.dayId === null ? null : detail.days.findIndex((day) => day.dayId === now.dayId);
  const today = dayIndex === null ? undefined : globals?.days[dayIndex];
  const ownZone = (today ?? globals?.days[0])?.timeZone;
  const zone = known(ownZone) ? ownZone : fallback;
  const passed =
    timedStops(detail, globals, fallback)
      .filter((stop) => stop.dayId === now.dayId && stop.end <= at)
      .at(-1) ?? null;
  // The name and the point from ONE stop: `weatherPlace`, the first city's
  // located stop (`placesOfDay`), not `place`, which is the clock's and on a
  // departure day the home airport's (KI-2026-10-24-m). A city no located stop
  // names keeps its name and gets no point rather than another stop's.
  const sky = today?.weatherPlace;
  const city =
    sky?.city != null
      ? { name: sky.city, lat: sky.lat, lng: sky.lng }
      : today?.cities[0] != null
        ? { name: today.cities[0], lat: null, lng: null }
        : null;
  return {
    phase: now.phase,
    dayIndex,
    local: { ...clockIn(zone, at), timeZone: zone },
    current: now.current,
    next: now.next,
    passed,
    city,
  };
}

/**
 * **The *now* line, on an under-way turn only** (M52 decision 14a), beside
 * `clockTimesLine`: a rule saying how to read it, and the instant itself as a
 * `data` block, because a stop's title is somebody's text. Before and after
 * the trip it is nothing, so those turns are told what they were told before.
 */
export function nowBlocks(now: TurnNow | null, detail: TripDetail): PromptBlock[] {
  if (now === null || now.phase !== "underway" || now.dayIndex === null) return [];
  const stop = (at: TripNowStop | null) => {
    if (at === null) return null;
    const window = detail.activities[at.activityId]?.timeWindow;
    return {
      title: untrusted(detail.activities[at.activityId]?.title ?? ""),
      day: detail.days.findIndex((day) => day.dayId === at.dayId) + 1,
      ...(window ? { from: window.start, to: window.end } : {}),
    };
  };
  return [
    rule(
      'The trip is under way. "Now" below is the local date and time where the trip is, today\'s day number, and the stop under way and the next one: read "now", "today", "here" and "nearby" against it.',
    ),
    data("Now", { date: now.local.date, time: now.local.time, day: now.dayIndex + 1, current: stop(now.current), next: stop(now.next) }),
  ];
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
/** The trip's non-dismissed conflicts numbered 1..n — the one numbering both the model's view and the resolver's ref lookup use. */
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
