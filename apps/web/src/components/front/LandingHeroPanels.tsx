"use client";

import type { Overlap } from "@/components/lenses/overlapData";
import { DayRiver } from "@/components/board/DayRiver";
import { riverAxis } from "@/components/board/riverLayout";
import type { CityAccents } from "@/components/pages/cityAccents";
import { ItineraryDayBlock } from "@/components/pages/blocks/ItineraryDayBlock";
import { TripStripBlock } from "@/components/pages/blocks/TripStripBlock";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { LANDING_DEMO } from "@/lib/landingDemo";

// The hero's Timeline and Notebook panels, drawn by the product's own
// components from a snapshot of the `/demo` trip (`lib/landingDemo.ts`) rather
// than transcribed from the design handoff. That is a deliberate divergence from
// `Trip Planner Redesign.dc.html:1885-1999`, recorded as `.design-sync/handoff/DRIFT.md`
// D20 and item 16 of docs/milestones/M26-design-parity.md's "The design is stale here" list.
//
// Loaded lazily by `LandingHeroArt`, which keeps this module's imports (the
// board's drag-and-drop, `@tc/pages`) out of `/welcome`'s first load.
//
// Both panels are read-only and fetch nothing (SPEC §14): the river gets
// `readOnly` and no gestures, which is the path `/demo`'s board takes, and the
// blocks are handed payloads `@tc/pages` resolved when the snapshot was made.

const { river, notebook, accents, currency } = LANDING_DEMO;

const RIVER_TITLE = `Day ${river.ordinal}`;
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
// A read-only river renders no control that could call these.
const nothing = () => {};

// `cityAccents`' answers, taken when the snapshot was made: the board's own
// colour for each day, without shipping the whole trip to work it out again.
const ACCENTS: CityAccents = {
  ofCity: () => "neutral",
  ofDayId: (dayId) => accents[dayId] ?? "neutral",
};

const PANEL_HEAD = "flex items-center gap-2.5 border-b border-hairline px-3.5 py-3";

/** The hero's Timeline panel: the board's own read-only river for the snapshot's day, under its day and city. */
export function TimelinePanel(): React.ReactElement {
  return (
    <>
      <div className={PANEL_HEAD}>
        <Text as="span" className="font-display font-semibold">
          {`${RIVER_TITLE} · ${river.city}`}
        </Text>
        <DataText className="ml-auto text-2xs tracking-wider uppercase">Timeline</DataText>
      </div>
      <div className="px-3.5 py-3">
        <DayRiver
          title={RIVER_TITLE}
          dayId={river.dayId}
          axis={RIVER_AXIS}
          activityIds={river.activityIds}
          activities={river.activities}
          accent={ACCENTS.ofDayId(river.dayId)}
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
      </div>
    </>
  );
}

/** The hero's Notebook panel: the trip strip and one day's card, as a notebook page draws them. */
export function NotebookPanel(): React.ReactElement {
  return (
    <>
      <div className={PANEL_HEAD}>
        <Text as="span" className="font-display font-semibold">
          Overview
        </Text>
        <DataText className="ml-auto text-2xs tracking-wider uppercase">Notebook</DataText>
      </div>
      {/* A fixed height, because the page is longer than the hero: the day
          card runs past it on purpose, a page continuing below the fold. 280px
          ends the panel just above the footer caption. Clipped rather than
          scrolled — a scrolling region inside the hero would take the page's
          wheel. */}
      <div className="relative h-70 overflow-hidden">
        <div className="flex flex-col gap-3 px-3.5 py-3.5">
          <TripStripBlock payload={notebook.strip} accents={ACCENTS} />
          <ItineraryDayBlock payload={notebook.day} />
        </div>
        {/* Faded into the panel's own surface so the last, partly shown row
            reads as more to come rather than as a clipping bug —
            `CalendarLens`' edge fade, turned to the bottom. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-surface" />
      </div>
    </>
  );
}
