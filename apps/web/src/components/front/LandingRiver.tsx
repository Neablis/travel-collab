"use client";

import type { Overlap } from "@/components/lenses/overlapData";
import { type BoardSuggestions, DayRiver } from "@/components/board/DayRiver";
import { riverAxis } from "@/components/board/riverLayout";
import type { CityAccents } from "@/components/pages/cityAccents";
import { FixedPeopleProvider, type Persona } from "@/components/pages/people";
import type { AccentFamily } from "@/lib/dayAccent";
import { LANDING_DEMO, type LandingRiverDay } from "@/lib/landingDemo";

// A snapshot's day on the board's own read-only river, as the phone's Together
// claim and the sea's crew moment draw it (M42 part 9, M51). The path a
// `/demo/<slug>` board takes: `readOnly`, no gestures, and every handler a
// no-op, because a read-only river renders no control that could call one.

const { river, accents, currency } = LANDING_DEMO;

/**
 * The whole day in the panel, rather than the board's 44px an hour clipped at
 * 3 pm (Mitchell, on the first screenshots): 20px an hour draws the demo day's
 * twelve hours in 240. The scale is the axis's own (`RiverAxis.pxPerHour`), so
 * blocks, ticks and text are laid out at it rather than shrunk by a transform:
 * the type stays at its board size, which is what keeps it legible, and a
 * short stop still gets the board's floor height rather than being squished.
 */
const DEMO_PX_PER_HOUR = 20;
const NO_CONFLICTS: ReadonlySet<string> = new Set();
const NO_OVERLAPS: ReadonlyMap<string, Overlap> = new Map();
const NO_PARTNERS: ReadonlyMap<string, readonly string[]> = new Map();
const nothing = () => {};

/** `cityAccents`' answers for a snapshot, taken when it was made, without shipping the whole trip to work them out again. */
export function snapshotAccents(byDay: Record<string, AccentFamily>): CityAccents {
  return { ofCity: () => "neutral", ofDayId: (dayId) => byDay[dayId] ?? "neutral" };
}

/** The demo trip's colours, for the blocks drawn beside its river. */
export const LANDING_ACCENTS: CityAccents = snapshotAccents(accents);

/** The river's title, "Day 7": what its list is named and what its panel heads read. */
export const LANDING_RIVER_TITLE = `Day ${river.ordinal}`;

/** The snapshot's city for the river's day, for the panel heads. */
export const LANDING_RIVER_CITY = river.city;

/** A snapshot's day on the board's read-only river; the demo trip's Day 7 unless told otherwise. */
export function LandingRiver({
  day = river,
  people = river.people,
  dayAccents = LANDING_ACCENTS,
  dayCurrency = currency,
  pxPerHour = DEMO_PX_PER_HOUR,
  suggestions,
}: {
  day?: LandingRiverDay;
  people?: Readonly<Record<string, Persona>>;
  dayAccents?: CityAccents;
  dayCurrency?: string;
  pxPerHour?: number;
  /** Ghost stops to draw on the day, as the board draws a pending suggestion's. */
  suggestions?: BoardSuggestions;
}): React.ReactElement {
  const axis = riverAxis(
    day.activityIds.map((id) => day.activities[id]?.timeWindow ?? null),
    pxPerHour,
  );
  // The snapshot's people, since the landing reads no access: without them a
  // block calls its adder by the id's handle (M51 decision 8a).
  return (
    <FixedPeopleProvider personas={people}>
      <DayRiver
        title={`Day ${day.ordinal}`}
        dayId={day.dayId}
        axis={axis}
        activityIds={day.activityIds}
        activities={day.activities}
        accent={dayAccents.ofDayId(day.dayId)}
        conflictIds={NO_CONFLICTS}
        overlaps={NO_OVERLAPS}
        overlapPartners={NO_PARTNERS}
        currency={dayCurrency}
        onEditActivity={nothing}
        onRemoveActivity={nothing}
        onDismissOverlap={nothing}
        focusedTag={null}
        readOnly
        suggestions={suggestions}
      />
    </FixedPeopleProvider>
  );
}
