"use client";

import { useMemo } from "react";
import type { ActivityTag, ActivityView } from "@tc/contracts";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import type { Overlap } from "@/components/lenses/overlapData";
import { DataText } from "@/components/ui/data-text";
import type { AccentFamily } from "@/lib/dayAccent";
import { RiverBlock } from "./RiverBlock";
import { layoutRiver, riverTicks, tickLabel, type RiverAxis } from "./riverLayout";

/**
 * One day's river: the hour ticks down a 32px gutter and the day's timed stops
 * drawn to scale beside them (SPEC §36.9b, M29 part 2).
 *
 * The ticks repeat in every column, as the design draws them, rather than
 * living in one sticky gutter: the row scrolls sideways past fourteen days,
 * and a column that has scrolled away from a shared gutter would be a column
 * with no hours on it.
 */
export function DayRiver({
  title,
  axis,
  activityIds,
  activities,
  accent,
  conflictIds,
  overlaps,
  overlapPartners,
  currency,
  onEditActivity,
  onRemoveActivity,
  onDismissOverlap,
  focusedTag,
  onToggleTag,
  readOnly,
}: {
  title: string;
  axis: RiverAxis;
  activityIds: readonly string[];
  activities: Record<string, ActivityView>;
  accent: AccentFamily;
  conflictIds: ReadonlySet<string>;
  overlaps: ReadonlyMap<string, Overlap>;
  overlapPartners: ReadonlyMap<string, readonly string[]>;
  currency: string;
  onEditActivity: (activityId: string) => void;
  onRemoveActivity: (activityId: string) => void;
  onDismissOverlap: (conflictId: string) => void;
  focusedTag: ActivityTag | null;
  onToggleTag?: (tag: ActivityTag) => void;
  readOnly: boolean;
}) {
  const clock = useTimeFormat();
  const timed = useMemo(
    () =>
      activityIds.flatMap((id) => {
        const activity = activities[id];
        return activity?.timeWindow ? [{ activity, window: activity.timeWindow }] : [];
      }),
    [activityIds, activities],
  );
  const placements = useMemo(
    () => new Map(layoutRiver(axis, timed.map(({ activity, window }) => ({ id: activity.activityId, window }))).map((p) => [p.id, p])),
    [axis, timed],
  );

  return (
    <div
      data-testid="day-river"
      className="relative"
      // eslint-disable-next-line no-restricted-syntax -- the river's height is the shared axis's length at 44px an hour (riverLayout.ts), a computed number with no token equivalent
      style={{ height: axis.heightPx }}
    >
      {riverTicks(axis).map((tick) => (
        <div
          key={tick.minute}
          aria-hidden
          className="pointer-events-none absolute inset-x-0"
          // eslint-disable-next-line no-restricted-syntax -- a tick's offset is its hour on the shared axis, computed geometry
          style={{ top: tick.topPx }}
        >
          <DataText size="xs" className="absolute left-0 w-8 -translate-y-1/2 text-right leading-none">
            {tickLabel(tick.minute, clock)}
          </DataText>
          <div className="ml-9.5 border-t border-hairline" />
        </div>
      ))}
      {/* 38px in: the 32px gutter and the 6px between it and the rule, the
          design's own numbers. A list, because a day's stops are one. */}
      <ul aria-label={`${title} timeline`} className="absolute inset-y-0 right-0 left-9.5 m-0 list-none p-0">
        {timed.map(({ activity, window }) => {
          const placement = placements.get(activity.activityId);
          if (placement === undefined) return null;
          const id = activity.activityId;
          return (
            <RiverBlock
              key={id}
              activity={activity}
              window={window}
              placement={placement}
              accent={accent}
              hasConflict={conflictIds.has(id)}
              overlap={overlaps.get(id) ?? null}
              overlapPartners={overlapPartners.get(id) ?? []}
              currency={currency}
              onEdit={() => onEditActivity(id)}
              onRemove={() => onRemoveActivity(id)}
              onDismissOverlap={onDismissOverlap}
              focusedTag={focusedTag}
              onToggleTag={onToggleTag}
              readOnly={readOnly}
            />
          );
        })}
      </ul>
    </div>
  );
}
