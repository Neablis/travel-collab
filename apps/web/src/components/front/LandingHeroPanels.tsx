"use client";

import { ItineraryDayBlock } from "@/components/pages/blocks/ItineraryDayBlock";
import { TripStripBlock } from "@/components/pages/blocks/TripStripBlock";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { LANDING_DEMO } from "@/lib/landingDemo";
import { LANDING_ACCENTS, LANDING_RIVER_CITY, LANDING_RIVER_TITLE, LandingRiver } from "./LandingRiver";

// The hero's Timeline and Notebook panels, drawn by the product's own
// components from a snapshot of the Japan demo (`lib/landingDemo.ts`) rather
// than transcribed from the design handoff. That is a deliberate divergence from
// `Trip Planner Redesign.dc.html:1885-1999`, recorded as `.design-sync/handoff/DRIFT.md`
// D20 and item 16 of docs/milestones/M26-design-parity.md's "The design is stale here" list.
//
// Loaded lazily by `LandingHeroArt`, which keeps this module's imports (the
// board's drag-and-drop, `@tc/pages`) out of the landing's first load.
//
// Both panels are read-only and fetch nothing (SPEC §14): the river gets
// `readOnly` and no gestures, which is the path a `/demo/<slug>` board takes, and the
// blocks are handed payloads `@tc/pages` resolved when the snapshot was made.

const { notebook } = LANDING_DEMO;

const PANEL_HEAD = "flex items-center gap-2.5 border-b border-hairline px-3.5 py-3";

/** The hero's Timeline panel: the board's own read-only river for the snapshot's day, under its day and city. */
export function TimelinePanel(): React.ReactElement {
  return (
    <>
      <div className={PANEL_HEAD}>
        <Text as="span" className="font-display font-semibold">
          {`${LANDING_RIVER_TITLE} · ${LANDING_RIVER_CITY}`}
        </Text>
        <DataText className="ml-auto text-2xs tracking-wider uppercase">Timeline</DataText>
      </div>
      <div className="px-3.5 py-3">
        <LandingRiver />
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
          <TripStripBlock payload={notebook.strip} accents={LANDING_ACCENTS} />
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
