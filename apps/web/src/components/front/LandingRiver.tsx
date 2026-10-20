"use client";

import type { Overlap } from "@/components/lenses/overlapData";
import { DayRiver } from "@/components/board/DayRiver";
import { riverAxis } from "@/components/board/riverLayout";
import type { CityAccents } from "@/components/pages/cityAccents";
import { FixedPeopleProvider } from "@/components/pages/people";
import { LANDING_DEMO } from "@/lib/landingDemo";

// The snapshot's day on the board's own read-only river, as the hero's Timeline
// panel and the Together block both draw it (M42 part 9). The path a
// `/demo/<slug>` board takes: `readOnly`, no gestures, and every handler a
// no-op, because a read-only river renders no control that could call one.

const { river, accents, currency } = LANDING_DEMO;

/**
 * The whole day in the panel, rather than the board's 44px an hour clipped at
 * 3 pm (Mitchell, on the first screenshots). The 430px hero leaves ~270px for
 * the river between the panel's header and the footer pill, and the day's axis
 * is 9:00–21:00, so 20px an hour draws all twelve hours in 240.
 * The scale is the axis's own (`RiverAxis.pxPerHour`), so blocks, ticks and
 * text are laid out at it rather than shrunk by a transform: the type stays at
 * its board size, which is what keeps it legible.
 */
const HERO_PX_PER_HOUR = 20;
const RIVER_AXIS = riverAxis(
  river.activityIds.map((id) => river.activities[id]?.timeWindow ?? null),
  HERO_PX_PER_HOUR,
);
const NO_CONFLICTS: ReadonlySet<string> = new Set();
const NO_OVERLAPS: ReadonlyMap<string, Overlap> = new Map();
const NO_PARTNERS: ReadonlyMap<string, readonly string[]> = new Map();
const nothing = () => {};

/**
 * `cityAccents`' answers, taken when the snapshot was made: the board's own
 * colour for each day, without shipping the whole trip to work it out again.
 */
export const LANDING_ACCENTS: CityAccents = {
  ofCity: () => "neutral",
  ofDayId: (dayId) => accents[dayId] ?? "neutral",
};

/** The river's title, "Day 7": what its list is named and what its panel heads read. */
export const LANDING_RIVER_TITLE = `Day ${river.ordinal}`;

/** The snapshot's city for the river's day, for the panel heads. */
export const LANDING_RIVER_CITY = river.city;

/** The snapshot's day on the board's read-only river, at a scale that fits the whole day in ~240px. */
export function LandingRiver(): React.ReactElement {
  // The snapshot's people, since the landing reads no access: without them a
  // block calls its adder by the id's handle (M51 decision 8a).
  return (
    <FixedPeopleProvider personas={river.people}>
      <DayRiver
        title={LANDING_RIVER_TITLE}
        dayId={river.dayId}
        axis={RIVER_AXIS}
        activityIds={river.activityIds}
        activities={river.activities}
        accent={LANDING_ACCENTS.ofDayId(river.dayId)}
        conflictIds={NO_CONFLICTS}
        overlaps={NO_OVERLAPS}
        overlapPartners={NO_PARTNERS}
        currency={currency}
        onEditActivity={nothing}
        onRemoveActivity={nothing}
        onDismissOverlap={nothing}
        focusedTag={null}
        readOnly
      />
    </FixedPeopleProvider>
  );
}
