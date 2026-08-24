"use client";

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { ActivityView, TripCommand, TripDetail, TripMember } from "@tc/contracts";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Preview } from "@/components/ui/preview";
import { EndOfTrip } from "@/components/trip/EndOfTrip";
import { KeepDayFlag } from "@/components/trip/KeepDayFlag";
import { chipModel } from "@/components/trip/DayChips";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useFocus } from "@/components/trip/context/FocusProvider";
import { GhostProposal } from "@/components/assistant/GhostProposal";
import { PREVIEW_GHOST_PROPOSAL } from "@/components/assistant/preview-fixtures";
import { dayAccents, type AccentFamily, type DayAccent } from "@/lib/dayAccent";
import { initialsFor } from "@/lib/initials";
import { shortPlace } from "@/lib/place";
import { DAY_END_MIN, formatDuration, toClockLabel, toMinutes, toTimeString } from "@/lib/time";
import { formatTripDate } from "@/lib/formatDate";
import { daySpend } from "@/lib/cost";
import { cn } from "@/lib/cn";
import { formatMoney } from "./formatMoney";
import { timelineRows, type TimelineRow } from "./timelineData";
import { badgeableConflictSubjects, overlapsForDay, type Overlap } from "./overlapData";
import { OverlapWarning } from "./OverlapWarning";

// Tailwind (v4, `@theme`-driven) only emits utilities it can see as literal
// text — a template-interpolated `bg-${family}-tint` never appears as a whole
// string anywhere and would silently fail to generate. Same static-map
// pattern as DayChips.tsx's CHIP_BG/DOT_BG and NextTripHero's
// STAT_TILE_TONE_CLASSES.
const TINT_BG: Record<AccentFamily, string> = {
  brand: "bg-brand-tint",
  info: "bg-info-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
  neutral: "bg-moss",
};
const SOLID_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-slate",
};
// "danger"/"warning"/"success"/"info" carry a `-ink` token; "brand" doesn't
// (its darkest tone is `-pressed`) — mirrors KeepDayFlag.tsx's INK_TEXT.
const INK_TEXT: Record<AccentFamily, string> = {
  brand: "text-brand-pressed",
  info: "text-info-ink",
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  neutral: "text-slate",
};

// Fallback DayAccent for an index dayAccents() didn't cover (shouldn't
// happen — `days`/`accents` are always built from the same array — but keeps
// the render loop total rather than risking a crash on a stale index).
const NEUTRAL_ACCENT: DayAccent = { tint: "neutral", ink: "neutral", solid: "neutral" };

// 09:00 on a day with nothing timed on it yet. This replaces the old
// DAY_START_MIN (06:00), which was a leftover from when the timeline drew a
// visible 06:00→midnight axis: the axis is long gone, and 06:00 was never a
// time anyone wants a stop prefilled at. 09:00 is the same default the
// unscheduled rack already places into an empty day
// (trip/fitIntoDay.ts's DEFAULT_START_MIN), so the two ways of putting a
// first stop on a bare day now agree. It stays a local constant rather than
// moving to lib/time.ts because it is a product default, not clock
// arithmetic — lib/time.ts owns the latter.
const EMPTY_DAY_START_MIN = 9 * 60;
const DEFAULT_SLOT_MIN = 60; // default duration for a freshly-suggested slot

// The latest wall-clock time anything on this day ends, raw "HH:MM", or null
// when the day has no timed activity to end after. `row.timed` is sorted by
// START, so the last element is not necessarily the last to finish.
function lastEndTime(row: TimelineRow): string | null {
  let latest: string | null = null;
  for (const item of row.timed) {
    if (latest === null || toMinutes(item.end) > toMinutes(latest)) latest = item.end;
  }
  return latest;
}

/**
 * The prefilled timeWindow behind both add-a-stop affordances on a day (the
 * day-header "Add stop" button and the per-day dashed add row) — or `null`
 * when the day has no room left for one.
 *
 * KI-30: this used to be
 * `{ start: toTimeString(lastEnd), end: toTimeString(lastEnd + 60) }`.
 * `toTimeString` clamps *silently* at DAY_END_MIN, so on a day whose last stop
 * already ends at or near midnight both ends collapsed to "23:59" — and
 * contracts' `TimeWindow` refines `start < end`, so the UI was offering a
 * window the domain would reject. The rule below is the one `overlapData.ts`'s
 * `repairedEnd()` already established for the overlap fix: do the arithmetic
 * in minutes, compare against DAY_END_MIN *before* formatting, and never let
 * the clamp be what decides the answer.
 *
 * Where it differs from `repairedEnd()` is deliberate. The overlap fix must
 * keep the moved stop's own duration, so a duration that will not fit has no
 * honest repair and the fix is withheld. A brand-new stop has no duration to
 * keep, so a day with 29 minutes left can still be offered those 29 minutes:
 * a short window is a real, valid, editable suggestion. Only a day that
 * already runs to 23:59 has nothing left to offer, and there `null` means the
 * affordance is WITHHELD — not degraded — exactly as a null `suggestedEnd`
 * makes OverlapWarning render no fix button at all.
 */
export function nextSlot(row: TimelineRow): { start: string; end: string } | null {
  const lastEnd = lastEndTime(row);
  if (lastEnd === null) {
    return { start: toTimeString(EMPTY_DAY_START_MIN), end: toTimeString(EMPTY_DAY_START_MIN + DEFAULT_SLOT_MIN) };
  }
  const start = toMinutes(lastEnd);
  if (start >= DAY_END_MIN) return null;
  return { start: toTimeString(start), end: toTimeString(Math.min(start + DEFAULT_SLOT_MIN, DAY_END_MIN)) };
}

// Copy table (phase-6-growth.md), verbatim: "Add a stop after {last end time}"
// on a day that already has something timed on it, "Add the first stop"
// otherwise. `toClockLabel` is what turns the contract's "21:00" into the
// design's "9 pm" — the same formatter the overlap warning's copy uses.
//
// A day holding only UNTIMED stops takes the "Add the first stop" branch: it
// has no last end time to name, so the other string is unwritable, and the
// slot it prefills (09:00) really is the day's first timed stop. The copy
// table offers no third string and this phase does not invent one.
function addRowLabel(row: TimelineRow): string {
  const lastEnd = lastEndTime(row);
  return lastEnd === null ? "Add the first stop" : `Add a stop after ${toClockLabel(lastEnd)}`;
}

// Shown on the day-header "Add stop" button when nextSlot() withholds a slot,
// so the disabled control says why rather than just going grey.
const NO_ROOM_LEFT = "This day already runs to midnight — there is no free time left to add a stop.";

// Real, honest sum of each timed activity's own duration (end − start) —
// NOT the elapsed span from first start to last end, which would count idle
// gaps as "out" time. This is the stop-meter's mono "Xh Ym out" figure.
function totalScheduledMinutes(row: TimelineRow): number {
  return row.timed.reduce((sum, item) => sum + Math.max(0, toMinutes(item.end) - toMinutes(item.start)), 0);
}

// A day's route line (day-header row 2): the distinct short place names
// (shortPlace(), lib/place.ts — city if the geocoder gave one, else the
// venue's own first comma-segment) visited that day, in chronological order,
// consecutive duplicates collapsed, capped with a "+N more" tail. shortPlace
// documents its own "no field for this, so the closest honest proxy" stance
// (the same one DayChips.tsx's cityFor documents for the day-chip city);
// this just applies it to every stop in the day instead of only the first.
// The handoff's row-2 example also appends a distance ("· 5.4 km on foot") —
// there is no honest way to fill that for an entire day (would require every
// consecutive pair to carry real coordinates), so per the task brief it is
// simply omitted rather than fabricated; individual legs (below) no longer
// attempt one either (Phase 8 Task 8.1) — they name real free time instead.
const ROUTE_MAX_STOPS = 3;
function routeSummary(row: TimelineRow, activities: TripDetail["activities"]): string | null {
  const names: string[] = [];
  for (const item of [...row.timed, ...row.untimed]) {
    const name = shortPlace(activities[item.activityId]?.location);
    if (name && names[names.length - 1] !== name) names.push(name);
  }
  if (names.length === 0) return null;
  const shown = names.slice(0, ROUTE_MAX_STOPS);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(" → ")} → +${extra} more` : shown.join(" → ");
}

// Handoff README §2 "Legs": past this much free time before the next stop,
// the leg also gets a warning-tint pill — nothing realistically gets planned
// into a gap this long, so it is worth flagging rather than just naming.
const NOTHING_PLANNED_THRESHOLD_MIN = 150;

// Handoff README §2 "Legs": indented dotted left border, mono free-time
// label, optional warning-tint pill. Phase 8 Task 8.1: this used to append an
// honestly-labeled straight-line "km direct" distance (there is no real
// travel-time/distance data source reachable from the UI — see lib/geo.ts's
// haversineKm comment; MapLens/mapRailData still use it for per-day
// distances) and warn past a 30-minute gap. Both are gone: the mono text now
// simply names the real free time before the next stop — "Back to back" when
// there is none — and the pill only fires once that free time is long enough
// that nothing is realistically planned in it.
function Leg({ prevEnd, nextStart }: { prevEnd: string; nextStart: string }) {
  const gap = toMinutes(nextStart) - toMinutes(prevEnd);
  // A genuinely negative gap is an overlap — a real conflict scenario
  // flagged separately by the Badge on the activity row below — with no
  // honest free time to name, so the leg renders nothing. gap === 0 (back
  // to back) still renders.
  if (gap < 0) return null;

  return (
    <div
      className="grid gap-4"
      // eslint-disable-next-line no-restricted-syntax -- fixed time-column width has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
      style={{ gridTemplateColumns: "92px 1fr" }}
    >
      <div />
      <div
        data-testid="timeline-leg"
        className="ml-px flex flex-wrap items-center gap-2 border-l-2 border-dotted border-border-strong py-1.5 pl-3.5"
      >
        <DataText size="xs" className="text-slate">
          {gap === 0 ? "Back to back" : formatDuration(gap, "until next stop")}
        </DataText>
        {gap >= NOTHING_PLANNED_THRESHOLD_MIN && (
          <span className="rounded-full bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning-ink">
            Nothing planned
          </span>
        )}
      </div>
    </div>
  );
}

// Handoff README §2 "Activity rows": 92px right-aligned time column, a Card
// with a 4px full-height accent rail, title, optional conflict Badge, place
// line, optional note block, and a right column with an attributee avatar +
// ghost "Ask" (Preview, M9) / "Edit" (real, unchanged behavior).
function ActivityRow({ start, end, activity, accent, hasConflict, member, currency, onSelectActivity }: {
  start: string | null;
  end: string | null;
  activity: ActivityView;
  accent: AccentFamily;
  hasConflict: boolean;
  member: TripMember | undefined;
  currency: string;
  onSelectActivity?: (activityId: string) => void;
}) {
  return (
    <div
      data-testid={`timeline-item-${activity.activityId}`}
      className="grid items-start gap-4"
      // eslint-disable-next-line no-restricted-syntax -- fixed time-column width has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
      style={{ gridTemplateColumns: "92px 1fr" }}
    >
      <div className="pt-3 text-right">
        {start && (
          <DataText size="sm" className="block text-ink">
            {start}
          </DataText>
        )}
        {end && <DataText size="xs" className="block">{end}</DataText>}
      </div>
      <Card className="flex items-stretch gap-3 rounded-lg p-4">
        <div aria-hidden className={cn("w-1 shrink-0 self-stretch rounded-full", SOLID_BG[accent])} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className="font-semibold text-ink"
              // eslint-disable-next-line no-restricted-syntax -- 15px activity title has no token equivalent (between text-md/16px and text-base/14px)
              style={{ fontSize: "15px" }}
            >
              {activity.title}
            </span>
            {hasConflict && (
              <Badge variant="warning" role="img" aria-label="conflict" title="This activity has conflicts">
                <AlertTriangle className="size-3" aria-hidden />
              </Badge>
            )}
          </div>
          {/* ActivityView has no separate "area" field (packages/contracts
              src/activity.ts) — this is shortPlace() (lib/place.ts), the same
              city-or-first-segment proxy DayChips.tsx's cityFor documents,
              applied per stop instead of per day. The `activity.location &&`
              guard here already ensures a real, defined Location, so this is
              always shortPlace's honest first-segment fallback at worst. */}
          {activity.location && (
            <Text as="span" variant="secondary" className="mt-1 block">
              {shortPlace(activity.location)}
            </Text>
          )}
          {activity.notes && (
            <div className="mt-1.5 rounded-sm bg-paper px-2 py-1.5 text-sm text-slate">{activity.notes}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {/* TripMember (packages/contracts src/trip.ts) carries only a
              userId, no display name and no per-activity "who's this for"
              field — the trip's first member is a generic, reasonable stand-in
              for "attributee avatar" rather than fabricated assignment data. */}
          {member && (
            <div className="flex items-center gap-1.5">
              <span
                className="text-slate"
                // eslint-disable-next-line no-restricted-syntax -- 11px attributee label has no token equivalent (below text-xs/12px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
                style={{ fontSize: "11px" }}
              >
                {member.userId}
              </span>
              <span
                aria-hidden
                className="grid shrink-0 place-items-center rounded-full bg-moss font-semibold text-slate"
                // eslint-disable-next-line no-restricted-syntax -- 22px avatar circle / 10px initials have no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
                style={{ height: "22px", width: "22px", fontSize: "10px" }}
              >
                {initialsFor(member.userId)}
              </span>
            </div>
          )}
          {/* Design values table, "timeline card cost": right column, under
              the attributee, mono, --color-slate. Money always routes
              through formatMoney (KI-2) keyed off the trip's own currency
              (Money is trip-level, never per-event — decision, 2026-08-14),
              never a hand-formatted string. `activity.cost` truthiness
              already covers both `null` (explicitly unset) and `undefined`
              (the contract asymmetry noted on ActivityView.cost) as "no
              cost" — no separate branch needed for the two. */}
          {activity.cost ? (
            <span className="flex items-center gap-1">
              <DataText size="xs">{formatMoney(activity.cost.amountMinor, currency)}</DataText>
              {/* Confirmed-vs-estimate cost state isn't modelled anywhere
                  (no field distinguishes a firm price from a guess) — an
                  inert Preview shell for the design's uppercase "est" badge,
                  M11. */}
              <Preview id="cost-estimate-state" size="compact">
                <span
                  className="rounded-full bg-moss px-1.5 py-0.5 font-mono font-semibold uppercase tracking-wide text-slate"
                  // eslint-disable-next-line no-restricted-syntax -- 10px "est" badge text has no token equivalent (below text-xs/12px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
                  style={{ fontSize: "10px" }}
                >
                  est
                </span>
              </Preview>
            </span>
          ) : (
            <DataText size="xs">No cost yet</DataText>
          )}
          <div className="flex gap-0.5">
            <Preview id="timeline-ghost" size="compact">
              <Button variant="ghost" size="sm">
                Ask
              </Button>
            </Preview>
            <Button
              variant="ghost"
              size="sm"
              data-testid={`timeline-edit-${activity.activityId}`}
              onClick={() => onSelectActivity?.(activity.activityId)}
            >
              Edit
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function TimelineLens({
  detail,
  onSelectActivity,
  onCommand,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
  // Same seam TripDateControl/TripMoneySettings use: the lens stays
  // presentational and hands a real command up to whoever owns dispatch
  // (TripBoardScreen), rather than reaching into useTrip() itself.
  onCommand?: (command: TripCommand) => void;
}) {
  const rows = timelineRows(detail);
  // Same per-day city derivation Task 8's DayChips established (first
  // scheduled activity's location.name) — reused via chipModel rather than
  // re-deriving it, so the day header's accent/pill and the day-chips row
  // above always agree on the same day's color and city.
  const days = useMemo(() => chipModel(detail), [detail]);
  // One dayAccents() call over the whole trip's cities, so collisions between
  // two days of this trip get probed against each other rather than each day
  // resolving blind to every other one.
  const accents = useMemo(() => dayAccents(days.map((d) => d.city)), [days]);
  const { openCreate } = useEditor();
  const { focusedDay, setFocusedDay } = useFocus();
  const headerRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Every activityId named as a subject of a badge-worthy conflict — the same
  // rule Board.tsx's conflictIds uses, shared from overlapData rather than
  // spelled out twice, so the two lenses cannot drift on which conflicts the
  // bare triangle covers. This lens has the room to lay out *every* overlap of
  // every day as a full OverlapWarning, so it hands that whole set over as
  // "already surfaced" — where Board, which chips one per stop, hands over
  // less and gets triangles for the rest (KI-29).
  const conflictActivityIds = useMemo(
    () =>
      badgeableConflictSubjects(
        detail,
        new Set(
          detail.days.flatMap((day) => overlapsForDay(detail, day.dayId).map((o) => o.conflictId)),
        ),
      ),
    [detail],
  );

  // "Start HH:MM" moves the later stop to begin when the earlier one ends,
  // keeping its own duration, and lets the day re-sort naturally. Nothing is
  // validated or prevented: if the move creates a new overlap further down the
  // day, the domain emits a new conflict and a new warning appears — conflicts
  // are data, not errors (AGENTS.md invariant 3). The one move that is not
  // offered at all is one that would not fit in the day (suggestedEnd null,
  // overlapData.ts): OverlapWarning renders no fix button for it, and this
  // guard makes the missing button and the missing command the same rule
  // rather than trusting the UI to be the only gate.
  const fixOverlap = (overlap: Overlap) => {
    if (overlap.suggestedEnd === null) return;
    onCommand?.({
      type: "UpdateActivity",
      tripId: detail.tripId,
      activityId: overlap.laterActivityId,
      timeWindow: { start: overlap.suggestedStart, end: overlap.suggestedEnd },
    });
  };

  // Dismissal is per conflict id, and that id encodes the *pair* — so this is
  // already the design's "dismissals are per stop-pair", with no new command
  // and no trip data changed.
  const dismissOverlap = (overlap: Overlap) => {
    onCommand?.({ type: "DismissConflict", tripId: detail.tripId, conflictId: overlap.conflictId });
  };

  // Appending a day is a real command (contracts' AddDay — already in the
  // TripCommand union, nothing new), raised through the SAME `onCommand` seam
  // the overlap fix and dismissal use rather than a second prop: ScheduleLens
  // forwards `onCommand` straight through, and TripBoardScreen hands whatever
  // arrives to the same `dispatch` its Board `onAddDay` callback uses. That is
  // also why the command is built here rather than in the screen — this seam
  // carries fully-formed commands, and the lens already builds its other two
  // the same way (client-minted ids, AGENTS.md invariant 4, the same reason
  // AddDay carries its own dayId at all).
  const addDay = () => {
    onCommand?.({ type: "AddDay", tripId: detail.tripId, dayId: crypto.randomUUID() });
    // Scroll-to-the-new-day reuses the focus effect below instead of inventing
    // a second scroll mechanism: a day is always APPENDED, so the new day's
    // index is the current day count. Its header ref only attaches on the
    // render that actually brings the day in, which is why the effect watches
    // `rows.length` as well as `focusedDay` — without it the effect would fire
    // once, against a ref that is still null, and never again.
    setFocusedDay(rows.length);
  };

  useEffect(() => {
    if (focusedDay === null) return;
    headerRefs.current[focusedDay]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedDay, rows.length]);

  if (rows.length === 0) {
    return <EmptyState title="No days yet." />;
  }

  return (
    <div
      data-testid="timeline-lens"
      className="mx-auto flex flex-col gap-5"
      // eslint-disable-next-line no-restricted-syntax -- 920px reading-width cap has no token equivalent (between --container-measure/640px and --container-content/1120px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
      style={{ maxWidth: "920px" }}
    >
      {rows.map((row, index) => {
        const chip = days[index];
        const accent = accents[index] ?? NEUTRAL_ACCENT;
        const isFocused = focusedDay === index;
        const stopCount = row.timed.length + row.untimed.length;
        const outMinutes = totalScheduledMinutes(row);
        const route = routeSummary(row, detail.activities);
        // chip.transitionTo only fires when this day's derived city differs
        // from the PREVIOUS day's — the previous day's own city is the
        // honest "from" half of the travel pill (chipModel doesn't carry it
        // directly, but it's just the prior index's chip).
        const fromCity = index > 0 ? (days[index - 1]?.city ?? null) : null;
        const isTravelDay = chip?.transitionTo !== null && chip?.transitionTo !== undefined;
        // Day-header cost chip (design values table): the day's own real
        // total, read via daySpend, which itself reads the server-computed
        // `days[].costSubtotal` rather than re-summing activity costs
        // client-side (cost.ts's own header comment on why) — rendered
        // through formatMoney keyed off the trip's own currency, same as
        // every other money surface.
        const { total: dayTotal } = daySpend(detail, row.dayId);
        // Every live, undismissed time-overlap on this day, already resolved
        // to the stop the warning hangs off (overlapData.ts).
        const overlaps = overlapsForDay(detail, row.dayId);
        // KI-30: one decision, both affordances. `null` means the day has no
        // free minute left, so the dashed add row is not rendered at all and
        // the header's "Add stop" goes disabled with a reason — rather than
        // either of them opening the editor on a window the domain rejects.
        const addSlot = nextSlot(row);
        // "Empty" for the copy table's purposes is a day with nothing on it at
        // all — no timed stops AND no untimed ones. A day holding only untimed
        // stops is not empty; it has stops, they just have no times yet.
        const isEmptyDay = stopCount === 0;

        return (
          <div key={row.dayId} data-testid={`timeline-row-${row.dayId}`} className="flex flex-col">
            <div
              ref={(el) => {
                headerRefs.current[index] = el;
              }}
              data-testid={`timeline-dayhead-${row.dayId}`}
              className={cn(
                "flex flex-col gap-2 rounded-xl p-3",
                TINT_BG[accent.tint],
                isFocused && "outline outline-2 outline-offset-2 outline-brand",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Heading level={3} className={cn("shrink-0", INK_TEXT[accent.ink])}>
                  Day {row.ordinal}
                </Heading>
                {row.date && (
                  <DataText size="sm" className={cn("shrink-0", INK_TEXT[accent.ink])}>
                    {formatTripDate(row.date)}
                  </DataText>
                )}
                {isTravelDay ? (
                  <span className="shrink-0 rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink">
                    {fromCity ?? "?"} <span className="text-slate">→</span> {chip?.transitionTo}
                  </span>
                ) : (
                  chip?.city && (
                    <span className="shrink-0 rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink">
                      {chip.city}
                    </span>
                  )
                )}
                {/* The day-header count badge: how many of this day's stop
                    pairs are still crossing, dismissals excluded, so a day
                    scrolled past still reads as "needs attention" without the
                    warnings themselves being on screen. */}
                {overlaps.length > 0 && (
                  <Badge variant="warning" className="shrink-0">
                    {overlaps.length} overlap{overlaps.length === 1 ? "" : "s"}
                  </Badge>
                )}
                <div className="flex-1" />
                <span className="flex shrink-0 items-center gap-2 rounded-full bg-surface px-2.5 py-1">
                  <span className="flex items-center gap-0.5" aria-hidden>
                    {Array.from({ length: stopCount }, (_, dotIndex) => (
                      <span key={dotIndex} className={cn("h-1.5 w-1.5 rounded-full", SOLID_BG[accent.solid])} />
                    ))}
                  </span>
                  <DataText size="xs" className="text-ink">
                    {formatDuration(outMinutes, "out")}
                  </DataText>
                </span>
                {/* "beside the stop meter", mono 12px, day-ink. */}
                <DataText
                  size="xs"
                  data-testid={`day-cost-${row.dayId}`}
                  className={cn("shrink-0 rounded-full bg-surface px-2.5 py-1", INK_TEXT[accent.ink])}
                >
                  {formatMoney(dayTotal, detail.currency)}
                </DataText>
                <Preview id="keep-day-flag" size="compact">
                  <KeepDayFlag dayIndex={index} accent={accent.ink} />
                </Preview>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid={`timeline-add-${row.dayId}`}
                  disabled={addSlot === null}
                  title={addSlot === null ? NO_ROOM_LEFT : undefined}
                  onClick={() => addSlot !== null && openCreate({ dayId: row.dayId, timeWindow: addSlot })}
                >
                  Add stop
                </Button>
              </div>
              {/* Row 2 is the day's route line. On an empty day there is no
                  route to summarise and "0 stops" is a worse thing to say than
                  the design's own copy, so the line carries that copy instead
                  — same place, same type treatment, no extra row invented. */}
              <div
                data-testid={`day-meta-${row.dayId}`}
                className={cn("flex flex-wrap items-baseline gap-1.5 font-mono text-xs", INK_TEXT[accent.ink])}
              >
                {isEmptyDay ? (
                  <span>No stops yet — add one, or drop a saved day onto it</span>
                ) : (
                  <>
                    <span>
                      {stopCount} stop{stopCount === 1 ? "" : "s"}
                    </span>
                    {route && (
                      <>
                        <span>·</span>
                        <span>{route}</span>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              {/* The day's summary, where its stops would otherwise be. Sits
                  in the same 92px/1fr grid every stop row and leg uses, so it
                  lines up with the cards above and below it instead of
                  floating in the gutter. */}
              {isEmptyDay && (
                <div
                  className="grid gap-4"
                  // eslint-disable-next-line no-restricted-syntax -- fixed time-column width has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
                  style={{ gridTemplateColumns: "92px 1fr" }}
                >
                  <div />
                  <Text as="span" variant="secondary" data-testid={`timeline-empty-${row.dayId}`}>
                    Nothing planned yet
                  </Text>
                </div>
              )}
              {row.timed.map((item, itemIndex) => {
                const activity = detail.activities[item.activityId];
                if (!activity) return null;
                const prev = row.timed[itemIndex - 1];
                return (
                  <div key={item.activityId} className="flex flex-col gap-3">
                    {prev && <Leg prevEnd={prev.end} nextStart={item.start} />}
                    {/* The warning belongs to the row above it, not to the
                        day's row rhythm — an inner wrapper with no gap so its
                        own 6px offset is the whole distance, rather than
                        gap-3 stacking on top of it. */}
                    <div>
                      <ActivityRow
                        start={item.start}
                        end={item.end}
                        activity={activity}
                        accent={accent.solid}
                        hasConflict={conflictActivityIds.has(item.activityId)}
                        member={detail.members[0]}
                        currency={detail.currency}
                        onSelectActivity={onSelectActivity}
                      />
                      {overlaps
                        .filter((overlap) => overlap.laterActivityId === item.activityId)
                        .map((overlap) => (
                          <OverlapWarning
                            key={overlap.conflictId}
                            overlap={overlap}
                            onFix={() => fixOverlap(overlap)}
                            onDismiss={() => dismissOverlap(overlap)}
                          />
                        ))}
                    </div>
                  </div>
                );
              })}
              {row.untimed.map((item) => {
                const activity = detail.activities[item.activityId];
                if (!activity) return null;
                return (
                  <ActivityRow
                    key={item.activityId}
                    start={null}
                    end={null}
                    activity={activity}
                    accent={accent.solid}
                    hasConflict={conflictActivityIds.has(item.activityId)}
                    member={detail.members[0]}
                    currency={detail.currency}
                    onSelectActivity={onSelectActivity}
                  />
                );
              })}
              {/* Task 15 (M9 Preview shell): one sample assistant proposal
                  ("ghost") card, rendered only in the currently-focused day —
                  never every day, since a real assistant would propose into
                  the day the user is actually looking at, not blanket every
                  row. Reuses the same registered "timeline-ghost" Preview id
                  as the per-activity "Ask" button above (Task 10); the
                  registry allows one id to back multiple surfaces. */}
              {isFocused && (
                <Preview id="timeline-ghost" size="container">
                  <GhostProposal proposal={PREVIEW_GHOST_PROPOSAL} onKeep={() => {}} onDiscard={() => {}} />
                </Preview>
              )}
              {/* The per-day add row: the day's own closing affordance, last
                  child of the day's body — the same position (and the same
                  dashed treatment) Column.tsx:125-135 gives the day columns'
                  "+ Add", which the phase file names as the reference.
                  Withheld entirely when nextSlot has no window to offer; see
                  its comment for why that is a withholding and not a
                  degradation. */}
              {addSlot !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`timeline-add-row-${row.dayId}`}
                  onClick={() => openCreate({ dayId: row.dayId, timeWindow: addSlot })}
                  className="w-full justify-center rounded-lg border border-dashed border-border-strong p-2 text-slate"
                  // eslint-disable-next-line no-restricted-syntax -- 13px add-row label (phase-6-growth.md design values) has no token equivalent (between text-xs/12px and text-sm/14px); `height: auto` releases Button size="sm"'s fixed h-7 so the specified 8px padding is what sets the height
                  style={{ fontSize: "13px", height: "auto" }}
                >
                  {addRowLabel(row)}
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {/* "Add a day" is real; the saved-day half of the block stays Preview.
          Rendered after the last day, and only when there is a last day — a
          trip with no days at all takes the EmptyState return above. */}
      <EndOfTrip onAddDay={addDay} />
    </div>
  );
}
