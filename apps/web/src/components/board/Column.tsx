"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { DragLocationHistory } from "@atlaskit/pragmatic-drag-and-drop/types";
import { X } from "lucide-react";
import type { ActivityTag, ActivityView } from "@tc/contracts";
import type { Overlap } from "@/components/lenses/overlapData";
import { Button } from "@/components/ui/button";
import { type AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";
import { Text } from "@/components/ui/text";
import { ActivityCard } from "./ActivityCard";
import { DayRiver, type RiverGestures } from "./DayRiver";
import type { RiverAxis } from "./riverLayout";

// Same static-map pattern as TimelineLens.tsx's TINT_BG / DayChips.tsx's
// CHIP_BG: Tailwind's JIT scanner can't see a template-interpolated
// `bg-${family}-tint`, so this is the only route from an AccentFamily to a
// real class.
const TINT_BG: Record<AccentFamily, string> = {
  brand: "bg-brand-tint",
  info: "bg-info-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
  neutral: "bg-moss",
};

// Handoff README §"Day columns view": 268px columns — not on Tailwind's
// default scale, so a token class doesn't exist for it (design-system.md
// Enforcement rule 4 bans arbitrary bracket values like w-[268px]). Matches
// TimelineLens/MapLens/ActivityCard's established inline-style + disable
// escape hatch for genuine one-off geometry.
//
// Exported because Phase 6's trailing "One more day?" column (Board.tsx) has
// to be exactly as wide as a day column for the row to read as "the trip
// could grow by one more of these" — two independent 268 literals could
// drift apart and the affordance would stop lining up.
export const DAY_COLUMN_WIDTH_PX = 268;

// A Column is a dated day column and nothing else now (Task 3.3): the
// unscheduled pool moved out of the board entirely, into the Unscheduled
// drawer, so `dayId` is always a real day and the old full-width/backlog
// variant — plus its `fullWidth` and `children` props — is gone.
export function Column({
  title,
  dayId,
  activityIds,
  activities,
  conflictIds,
  overlaps,
  overlapPartners,
  axis,
  currency,
  accent,
  onEditActivity,
  onRemoveActivity,
  onRemoveDay,
  isFocused = false,
  onSelect,
  columnRef,
  onAddActivity,
  onDismissOverlap,
  focusedTag = null,
  onToggleTag,
  readOnly = false,
  fullWidth = false,
  keepFlag,
  gestures,
}: {
  title: string;
  /**
   * **Take the whole width instead of the desktop's 268px** — M26 link 13.
   *
   * A phone shows one day at a time (§13.4), and one fixed-width column on a
   * 390px screen leaves the card at 241px and its text at 141px. The measured
   * numbers and the decision are in `M26-design-parity.md`'s link 13.
   */
  fullWidth?: boolean;
  dayId: string;
  activityIds: string[];
  activities: Record<string, ActivityView>;
  conflictIds: ReadonlySet<string>;
  // This day's live time-overlaps, keyed by the stop the warning attaches to
  // (the later one) — same derivation the timeline uses, so a crossing pair
  // reads the same in both lenses.
  overlaps: ReadonlyMap<string, Overlap>;
  /**
   * Every stop in an undismissed overlap, with the titles of the stops it
   * overlaps — both halves of a pair, where `overlaps` holds only the later
   * one. The river marks both blocks OVERLAP (SPEC §36.9b); the dismiss stays
   * on the later one, as it always has.
   */
  overlapPartners: ReadonlyMap<string, readonly string[]>;
  /** The trip's one shared time axis — the same for every column. */
  axis: RiverAxis;
  currency: string;
  // Per-day tint (Task 2's dayAccents, keyed off the same chipModel city
  // derivation Tasks 8/10 use).
  accent: AccentFamily;
  onEditActivity: (activityId: string) => void;
  onRemoveActivity: (activityId: string) => void;
  onRemoveDay?: () => void;
  /** True when this day is the one the day-chips row has ringed. */
  isFocused?: boolean;
  /** Selects this day, exactly as clicking its chip above does. */
  /** Receives `true` when the click should CLEAR the focus (see the header). */
  onSelect?: (clearing: boolean) => void;
  /**
   * The column's own element, handed up so `Board` can measure where it sits
   * along the row (its scroll spy) and scroll it into view on an arrow key.
   * A callback ref rather than a `RefObject`, because the caller keeps one
   * entry per day rather than one ref.
   */
  columnRef?: (node: HTMLElement | null) => void;
  onAddActivity?: () => void;
  onDismissOverlap: (conflictId: string) => void;
  /** SPEC §11's focused tag, passed to every card so off-tag stops dim. */
  focusedTag?: ActivityTag | null;
  /** Passed to every card's chips; withheld leaves them plain text. */
  onToggleTag?: (tag: ActivityTag) => void;
  /** Passed to every card: hide what writes, keep what reads (ADR-031). */
  readOnly?: boolean;
  /**
   * SPEC §24's "keep this day" pennant, for the day header this column draws.
   *
   * A slot rather than the five props the control itself takes (`tripId`,
   * `tripName`, `dayIndex`, the day's `SavedStop[]`), because none of them is
   * anything a COLUMN knows: they are trip-level, and `Board` is already
   * holding the `TripDetail` they come out of. Handing them through here would
   * make every column's signature carry the trip in order to draw one button.
   *
   * Optional, like `onRemoveDay` and `onAddActivity` above, and for the same
   * reason: a read-only board simply does not pass it. SPEC §24 — "nothing
   * renders disabled ... the Keep pennant [is] absent, so the page reads as a
   * finished thing rather than a form you lack permission for."
   */
  keepFlag?: ReactNode;
  /**
   * The river's gestures for this day (M29 part 3) — double-click, sketch,
   * resize and drop-at-a-time. Withheld on a read-only board, like
   * `onAddActivity`, and then the river offers none.
   */
  gestures?: RiverGestures;
}) {
  // **The whole column is the drop target** (M29 part 2). It was the card
  // list, which filled the column below the header; now the column is a shelf
  // and a river, and a stop dragged over either — or over a river block, which
  // is not a drop target of its own (RiverBlock) — means "this day". Part 3
  // nests the river's own target inside it, which adds "at this time".
  const [section, setSection] = useState<HTMLElement | null>(null);
  const sectionRef = useCallback(
    (node: HTMLElement | null) => {
      setSection(node);
      columnRef?.(node);
    },
    [columnRef],
  );
  // Whether this column itself — not one of its untimed cards — is the
  // innermost drop target. ActivityCard's own top/bottom edge line covers
  // every case where a card *is* the innermost target; this covers what's
  // left, which is exactly where resolveDrop.ts's "dropped on a column"
  // branch fires. No hover tint on the column itself (Task 3.3).
  const [isOver, setIsOver] = useState(false);

  // Untimed stops cannot sit on an axis, so they get the "Any time" shelf
  // above it; everything with a window goes on the river. List order is kept
  // on the shelf — it is the only order an untimed stop has. A phone draws no
  // river, so its shelf is every stop (see the shelf below).
  const shelf = useMemo(
    () =>
      activityIds.flatMap((id) => {
        const activity = activities[id];
        return activity && (fullWidth || !activity.timeWindow) ? [activity] : [];
      }),
    [activityIds, activities, fullWidth],
  );

  useEffect(() => {
    const el = section;
    if (!el) return;
    const updateIsOver = ({ location }: { location: DragLocationHistory }) =>
      setIsOver(location.current.dropTargets[0]?.element === el);
    return dropTargetForElements({
      element: el,
      getData: () => ({ dayId }),
      onDragEnter: updateIsOver,
      onDrag: updateIsOver,
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [dayId, section]);

  return (
    <section
      ref={sectionRef}
      data-testid="day-column"
      // SPEC §28's city rule, and the ONLY thing this component does for it.
      // In Ledger a pale tint reads as grey on cream, so anything city-coded
      // also gets a 3px solid rule in its own city's colour. The rule itself
      // lives in the look layer (`globals.css`, `html[data-look="ledger"]
      // [data-city-accent]`) because it is Ledger's, not a token; this names
      // the family so that layer has something to colour it with.
      data-city-accent={accent}
      className={cn(
        // `row-span-4 grid-rows-subgrid`: on the desktop row every column
        // shares the row's four tracks (globals.css `.day-columns-row`), so
        // shelves of different heights still start every river at the same
        // height. On a phone the parent is not a grid, `subgrid` falls back
        // to ordinary rows, and the column simply stacks.
        "row-span-4 grid min-h-44 grid-rows-subgrid gap-y-2 rounded-2xl p-2",
        // **`shrink-0` only while there is a row to shrink in** (M26 link 13).
        // A phone renders ONE column and it takes the width; keeping
        // `shrink-0` there would be harmless and keeping the 268px would not,
        // so the two move together.
        fullWidth ? "w-full" : "shrink-0",
        TINT_BG[accent],
        // Same ring the focused chip wears (DayChips), so "this day" reads the
        // same whichever of the two you picked it from.
        isFocused && "ring-2 ring-brand",
      )}
      // **268px is a DESKTOP constant, and link 13 is what it cost.** Measured
      // 2026-09-20 at 390x844: a phone was rendering this fixed column inside a
      // horizontally scrolling row, so a stop card was 241px wide and its text
      // column 141px — narrow because of a layout constant, not because the
      // screen is. §13.4 already says the answer ("a phone can hold one day at
      // a time; the rail is how you change which"), and `fullWidth` is it.
      //
      // eslint-disable-next-line no-restricted-syntax -- 268px day-column width has no token equivalent, matching MapLens/ActivityCard's computed-geometry pattern
      style={fullWidth ? undefined : { width: DAY_COLUMN_WIDTH_PX }}
    >
      {/* `data-day-header` is what the day-sync contract scrolls to, and it is
          the header rather than the `section` above for a reason a person
          reported: *"When you first switch to plan page, its half way scroll
          down the actual columns, it should start at the top so i can see the
          days"* (Mitchell, preview, 2026-09-13). `scrollIntoView` moves EVERY
          scrollable ancestor, the page included, and `block: "nearest"` is only
          "move nothing" while the target already fits on screen. A day column
          never does: the columns are flex siblings, so every one of them
          stretches to the tallest, and the row is routinely taller than the
          viewport — so `nearest` fell through to "align its top edge with the
          top of the scrollport", which is a page scroll of exactly the height
          of everything above the columns, landing the day headers underneath
          the sticky trip header. Measured in Chromium on the real geometry:
          targeting the column put the page at `scrollY` 180 and targeting this
          header left it at 0, with an identical `scrollLeft` on the row — the
          header spans the column's full width, so centring it horizontally IS
          centring the column.

          It is also the more honest target. What must come into view is the
          day's NAME; the cards under it are what you scroll to next.

          `day-sync-target` is the other half of that: with the page scrolled
          down, "nearest" aligns this header with the top of the scrollport,
          which is under the sticky header stack — the class's scroll margin is
          what makes it land just below it instead (globals.css,
          KI-2026-09-13-a). */}
      <header data-day-header className="day-sync-target flex items-baseline justify-between">
        {/* Mitchell, preview feedback on PR #55: "You should also be able to
            select the day here, and it syncs to the day card above." The chips
            row was the only way to focus a day; the column you are already
            looking at is the more obvious place to click. Same call as the
            chip's, same `aria-pressed`, and — since M16 Wave 2 gave the chips
            a toggle-off — the same toggle-off, because matching the chips
            beats inventing a second selection idiom on the same state. It
            reports WHETHER it is clearing rather than what to focus, so the
            index stays where it already lived (Board.tsx). */}
        {onSelect ? (
          <Button
            variant="ghost"
            onClick={() => onSelect(isFocused)}
            aria-pressed={isFocused}
            className="h-auto p-0 text-sm font-semibold text-ink hover:bg-transparent hover:underline"
          >
            {title}
          </Button>
        ) : (
          <span className="text-sm font-semibold text-ink">{title}</span>
        )}
        {/* The day header's own controls, in the order the design draws them:
            keep this day, then remove it. Wrapped rather than left as two
            siblings of the title, so `justify-between` keeps meaning "title at
            one end, controls at the other" whether one, both or neither is
            given. `items-center` inside a `items-baseline` header because the
            pennant is a 30px circle with no text baseline to sit on. */}
        <span className="flex items-center gap-1">
          {keepFlag}
          {onRemoveDay && (
            <Button variant="ghost" size="icon" onClick={onRemoveDay} aria-label={`Remove ${title}`}>
              <X className="size-3.5" aria-hidden />
            </Button>
          )}
        </span>
      </header>
      {/* **The "Any time" shelf** (M29 part 2). A stop with no time cannot sit
          on a to-scale axis, and it must not vanish either (M29's gate: "an
          untimed stop is visible"). So it keeps the card it always had, on a
          shelf above the river — above rather than below, because below would
          put it under 600-odd pixels of day. The shelf is always rendered,
          empty or not: it is the second of the four rows every column shares,
          and a column that skipped it would shift its river up a row.

          **A phone keeps the list** (`fullWidth`). The design draws the river
          on the desktop only; its phone Plan is a list of stop cards
          (`phoneStops`, `…Redesign.dc.html:863`), and a to-scale block on a
          phone would put a 30-minute stop's controls in a 24px box, under
          SPEC §13.1's 44px floor. So there, every stop is a card in this list,
          in the day's own order, as before. */}
      <div className="flex min-w-0 flex-col gap-1">
        {shelf.length > 0 && (
          <>
            {!fullWidth && (
              <Text variant="muted" as="span" className="px-1 font-semibold">
                Any time
              </Text>
            )}
            <ul aria-label={fullWidth ? `${title} stops` : `${title}, any time`} className="m-0 list-none p-0">
              {shelf.map((activity) => (
                <ActivityCard
                  key={activity.activityId}
                  activity={activity}
                  dayId={dayId}
                  hasConflict={conflictIds.has(activity.activityId)}
                  // An untimed stop cannot overlap anything; on the phone's
                  // list, a card carries its overlap chip as it always has.
                  overlap={fullWidth ? (overlaps.get(activity.activityId) ?? null) : null}
                  currency={currency}
                  onEdit={() => onEditActivity(activity.activityId)}
                  onRemove={() => onRemoveActivity(activity.activityId)}
                  onDismissOverlap={onDismissOverlap}
                  focusedTag={focusedTag}
                  onToggleTag={onToggleTag}
                  readOnly={readOnly}
                />
              ))}
            </ul>
          </>
        )}
        {/* The "this day" half of the drop feedback: shown only while the
            column itself, not one of its cards, is the innermost drop target.
            Over the river, the river is (M29 part 3) and draws its own outline
            at the pointer's time; this is everywhere else in the column, where
            a dropped stop keeps its time, so a timed one lands on the river at
            that time and an untimed one at the end of this shelf — which is
            where this line sits. (An untimed stop off the rack dropped here is
            given a fitted time, `rackDropWindow`.) Over the river, a stop off
            the rack lands at the river's time like any other (`placeWindow`). */}
        {isOver && <span aria-hidden className="h-0.5 rounded-full bg-brand" />}
      </div>
      {!fullWidth && (
        <DayRiver
          title={title}
          dayId={dayId}
          axis={axis}
          activityIds={activityIds}
          activities={activities}
          accent={accent}
          conflictIds={conflictIds}
          overlaps={overlaps}
          overlapPartners={overlapPartners}
          currency={currency}
          onEditActivity={onEditActivity}
          onRemoveActivity={onRemoveActivity}
          onDismissOverlap={onDismissOverlap}
          focusedTag={focusedTag}
          onToggleTag={onToggleTag}
          readOnly={readOnly}
          gestures={gestures}
        />
      )}
      {/* SPEC §36.9b: "+ Add a stop sits 22 px below the axis, brand-tinted
          and full width" — 22px is the row gap (8px) plus this margin. A
          wrapper even when there is no button, so a read-only column still
          fills the fourth row it shares with its neighbours. The accessible
          name is still "Add activity to Day N", which specs and tests across
          the suite find it by. */}
      <div>
        {onAddActivity && (
          <Button
            variant="ghost"
            onClick={onAddActivity}
            aria-label={`Add activity to ${title}`}
            // The design's own hint for the river's two faster ways in.
            title="Or double-click the timeline, or drag across empty time"
            className="mt-3.5 w-full justify-center rounded-lg border border-brand bg-brand-tint font-semibold text-brand-pressed hover:bg-surface hover:text-brand-pressed"
          >
            + Add a stop
          </Button>
        )}
      </div>
    </section>
  );
}
