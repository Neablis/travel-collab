"use client";

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { ActivityView, Location, TripCommand, TripDetail, TripMember } from "@tc/contracts";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Preview } from "@/components/ui/preview";
import { KeepDayFlag } from "@/components/trip/KeepDayFlag";
import { chipModel } from "@/components/trip/DayChips";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useFocus } from "@/components/trip/context/FocusProvider";
import { GhostProposal } from "@/components/assistant/GhostProposal";
import { PREVIEW_GHOST_PROPOSAL } from "@/components/assistant/preview-fixtures";
import { dayAccentFor, type AccentFamily } from "@/lib/dayAccent";
import { haversineKm } from "@/lib/geo";
import { initialsFor } from "@/lib/initials";
import { formatDuration, toMinutes, toTimeString } from "@/lib/time";
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
};
const SOLID_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};
// "danger"/"warning"/"success"/"info" carry a `-ink` token; "brand" doesn't
// (its darkest tone is `-pressed`) — mirrors KeepDayFlag.tsx's INK_TEXT.
const INK_TEXT: Record<AccentFamily, string> = {
  brand: "text-brand-pressed",
  info: "text-info-ink",
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
};

const DAY_START_MIN = 6 * 60; // 06:00 — only used as the fallback default for a day with no timed activities yet, no longer drawn as a visible axis
const DEFAULT_SLOT_MIN = 60; // default duration for a freshly-suggested slot

// The day-foot "+ Add stop" trigger's timeWindow: start right after the
// day's last timed activity ends (so a new activity slots in chronologically
// without the user having to retype a time), or DAY_START_MIN if there are
// no timed activities yet. Unchanged from the pre-restyle implementation.
function nextSlot(row: TimelineRow): { start: string; end: string } {
  const lastEnd = row.timed.reduce((max, item) => Math.max(max, toMinutes(item.end)), DAY_START_MIN);
  const start = row.timed.length > 0 ? lastEnd : DAY_START_MIN;
  return { start: toTimeString(start), end: toTimeString(start + DEFAULT_SLOT_MIN) };
}

// Real, honest sum of each timed activity's own duration (end − start) —
// NOT the elapsed span from first start to last end, which would count idle
// gaps as "out" time. This is the stop-meter's mono "Xh Ym out" figure.
function totalScheduledMinutes(row: TimelineRow): number {
  return row.timed.reduce((sum, item) => sum + Math.max(0, toMinutes(item.end) - toMinutes(item.start)), 0);
}

// A day's route line (day-header row 2): the distinct real place names
// (ActivityView.location.name) visited that day, in chronological order,
// consecutive duplicates collapsed, capped with a "+N more" tail — the same
// "no field for this, so the closest honest proxy is location.name"
// stance DayChips.tsx's cityFor documents, just applied to every stop in the
// day instead of only the first. The handoff's row-2 example also appends a
// distance ("· 5.4 km on foot") — there is no honest way to fill that for an
// entire day (would require every consecutive pair to carry real
// coordinates), so per the task brief it is simply omitted rather than
// fabricated; individual legs (below) show a real distance when they can.
const ROUTE_MAX_STOPS = 3;
function routeSummary(row: TimelineRow, activities: TripDetail["activities"]): string | null {
  const names: string[] = [];
  for (const item of [...row.timed, ...row.untimed]) {
    const name = activities[item.activityId]?.location?.name;
    if (name && names[names.length - 1] !== name) names.push(name);
  }
  if (names.length === 0) return null;
  const shown = names.slice(0, ROUTE_MAX_STOPS);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(" → ")} → +${extra} more` : shown.join(" → ");
}

// A gap "counts" as a leg only when it's positive — back-to-back or
// overlapping activities (a real conflict scenario, flagged separately by
// the Badge below) have no honest elapsed gap to report.
const GAP_WARNING_THRESHOLD_MIN = 30;

function locationCoords(location: Location | null | undefined): { lat: number; lng: number } | null {
  return location?.lat !== undefined && location?.lng !== undefined ? { lat: location.lat, lng: location.lng } : null;
}

// Handoff README §2 "Legs": indented dotted left border, mono travel time,
// optional warning-tint gap pill. There is no real travel-time/distance data
// source reachable from the UI (see lib/geo.ts's haversineKm comment) — so the
// mono text is the real elapsed gap between one activity's end and the
// next's start (both real TimeWindow strings already on hand), and the
// pill fires only past GAP_WARNING_THRESHOLD_MIN. A real straight-line
// distance is appended, honestly labeled "direct" (never "travel time" or
// "walking time", which would imply a transport mode and speed this app has
// no basis for), only when BOTH endpoints carry real lat/lng — otherwise the
// distance is omitted rather than guessed.
function Leg({ prevEnd, nextStart, prevLocation, nextLocation }: {
  prevEnd: string;
  nextStart: string;
  prevLocation: Location | null | undefined;
  nextLocation: Location | null | undefined;
}) {
  const gap = toMinutes(nextStart) - toMinutes(prevEnd);
  if (gap <= 0) return null;

  const from = locationCoords(prevLocation);
  const to = locationCoords(nextLocation);
  const distanceKm = from && to ? haversineKm(from, to) : null;

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
          {formatDuration(gap, "gap")}
          {distanceKm !== null && ` · ~${distanceKm.toFixed(1)} km direct`}
        </DataText>
        {gap > GAP_WARNING_THRESHOLD_MIN && (
          <span className="rounded-full bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning-ink">Long gap</span>
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
              src/activity.ts) — this is just the place name (location.name),
              the same single-string proxy DayChips.tsx's cityFor documents. */}
          {activity.location && (
            <Text as="span" variant="secondary" className="mt-1 block">
              {activity.location.name}
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
  const { openCreate } = useEditor();
  const { focusedDay } = useFocus();
  const headerRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Every activityId named as a subject of a badge-worthy conflict — the same
  // rule Board.tsx's conflictIds uses, shared from overlapData rather than
  // spelled out twice, so the two lenses cannot drift on which kinds the bare
  // triangle covers.
  const conflictActivityIds = useMemo(
    () => badgeableConflictSubjects(detail.conflicts),
    [detail.conflicts],
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

  useEffect(() => {
    if (focusedDay === null) return;
    headerRefs.current[focusedDay]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedDay]);

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
        const accent = dayAccentFor(chip?.city ?? null);
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
                  onClick={() => openCreate({ dayId: row.dayId, timeWindow: nextSlot(row) })}
                >
                  Add stop
                </Button>
              </div>
              <div className={cn("flex flex-wrap items-baseline gap-1.5 font-mono text-xs", INK_TEXT[accent.ink])}>
                <span>
                  {stopCount} stop{stopCount === 1 ? "" : "s"}
                </span>
                {route && (
                  <>
                    <span>·</span>
                    <span>{route}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              {row.timed.map((item, itemIndex) => {
                const activity = detail.activities[item.activityId];
                if (!activity) return null;
                const prev = row.timed[itemIndex - 1];
                const prevActivity = prev ? detail.activities[prev.activityId] : undefined;
                return (
                  <div key={item.activityId} className="flex flex-col gap-3">
                    {prev && (
                      <Leg
                        prevEnd={prev.end}
                        nextStart={item.start}
                        prevLocation={prevActivity?.location}
                        nextLocation={activity.location}
                      />
                    )}
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
