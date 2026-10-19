"use client";

import { DiscoverCard } from "@/components/playbooks/DiscoverCard";
import { ItineraryDayBlock } from "@/components/pages/blocks/ItineraryDayBlock";
import { SunBlock } from "@/components/pages/blocks/SunBlock";
import { TripPeopleBlock } from "@/components/pages/blocks/TripPeopleBlock";
import { TripStripBlock } from "@/components/pages/blocks/TripStripBlock";
import { Segs } from "@/components/pages/WidgetSegs";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { LANDING_DEMO, LANDING_FEATURES } from "@/lib/landingDemo";
import { LANDING_ACCENTS, LANDING_RIVER_CITY, LANDING_RIVER_TITLE, LandingRiver } from "./LandingRiver";

// The landing's Together, Playbooks and Notebook blocks, and the phone's claims
// under the same three headings, drawn by the product's own components (M42
// part 9) from the committed snapshots (`lib/landingDemo.ts`). Countdown is
// not here: `NextTripHero` fetches its trip and reads the clock, and the
// landing does neither (SPEC §14), so it stays a drawing.
//
// Loaded lazily by `LandingFeaturePanel`, as `LandingHeroPanels` is by the
// hero, which keeps the river's drag-and-drop and `@tc/pages` out of
// the landing's first load. Each panel carries its own surface, so a block and
// a phone claim can hold the same one.

const SURFACE = "overflow-hidden rounded-lg border border-hairline bg-surface";

/** Together: the demo trip's day on the board's own read-only river, under its day and city. */
export function TogetherPanel(): React.ReactElement {
  return (
    <div className={SURFACE}>
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-2.5">
        <Text as="span" className="font-display font-semibold">
          {`${LANDING_RIVER_TITLE} · ${LANDING_RIVER_CITY}`}
        </Text>
        <DataText className="ml-auto text-2xs tracking-wider uppercase">Timeline</DataText>
      </div>
      <div className="px-3.5 py-3">
        <LandingRiver />
      </div>
    </div>
  );
}

/**
 * Playbooks: Mitchell's Hanoi playbook as Discover draws it, its cover photo
 * and the photographer's credit leading. Signed out, so its links
 * lead into the open library (ADR-061), and its tags are plain chips — a
 * landing card sends nobody into tag pages.
 */
export function PlaybookPanel(): React.ReactElement {
  return (
    <ul className="flex flex-col">
      <DiscoverCard day={LANDING_FEATURES.playbook} origin={{ from: "playbooks" }} />
    </ul>
  );
}

/**
 * The shelf's second day (M50 part 9): a library playbook beside Mitchell's,
 * drawn by the same card from the same snapshot, so the spread reads as days
 * to borrow rather than one.
 */
export function ShelfPlaybookPanel(): React.ReactElement {
  return (
    <ul className="flex flex-col">
      <DiscoverCard day={LANDING_FEATURES.shelf} origin={{ from: "playbooks" }} />
    </ul>
  );
}

/**
 * Playbooks at phone size: the same card without its cover photo, city chips,
 * stop rows and tag chips, so it fits under the phone's headline on a 390×664
 * screen (the pinned stage clips what runs past it). What kind of day it is
 * still says what the tags would, and the title still opens the whole day.
 */
export function CompactPlaybookPanel(): React.ReactElement {
  return (
    <ul className="flex flex-col">
      <DiscoverCard day={{ ...LANDING_FEATURES.playbook, cover: null, cities: [], preview: [], tags: [] }} origin={{ from: "playbooks" }} />
    </ul>
  );
}

const PAGE = "flex flex-col gap-3 rounded-md border border-hairline bg-paper px-3.75 py-3.5";

/** One of the page's paragraphs: the author's words with the widgets' values in them. */
function Paragraph({ segs }: { segs: (typeof LANDING_FEATURES.memory)[number] }): React.ReactElement {
  return (
    <Text as="p" className="text-sm leading-relaxed text-pretty">
      <Segs segs={segs} accents={LANDING_ACCENTS} />
    </Text>
  );
}

/**
 * Notebook at phone size: a page somebody wrote about a day of the demo trip,
 * under the trip's strip. Its values are widgets resolved against the trip,
 * drawn as a notebook draws them; none of them is money (Mitchell, 2026-10-11).
 */
export function MemoryPanel(): React.ReactElement {
  return (
    <div className={PAGE}>
      <TripStripBlock payload={LANDING_DEMO.notebook.strip} accents={LANDING_ACCENTS} />
      {LANDING_FEATURES.memory.map((segs, i) => (
        <Paragraph key={i} segs={segs} />
      ))}
    </div>
  );
}

/**
 * Notebook: the same page as a notebook holds it once somebody has lived the
 * day (M50 part 9, Mitchell's walk: the frame was mostly empty). The words
 * between the notebook's own block widgets — the day's stops at their times,
 * its daylight — and signed by who was there. Read-only payloads drawn by the
 * blocks directly, not through the editor's dispatcher, so `/` stays static.
 *
 * Signed with the people widget's chips and not its sentence: that is the
 * trip's "Who's going", future tense ("are going with Sam"), and this page is
 * about a day already lived.
 */
export function NotebookPagePanel(): React.ReactElement {
  const [opening, ...rest] = LANDING_FEATURES.memory;
  const { day, sun, people } = LANDING_FEATURES.page;
  return (
    <div data-testid="notebook-page" className={PAGE}>
      <TripStripBlock payload={LANDING_DEMO.notebook.strip} accents={LANDING_ACCENTS} />
      {opening && <Paragraph segs={opening} />}
      <ItineraryDayBlock payload={day} />
      <SunBlock payload={sun} accents={LANDING_ACCENTS} />
      {rest.map((segs, i) => (
        <Paragraph key={i} segs={segs} />
      ))}
      <TripPeopleBlock payload={{ ...people, sentence: "" }} />
    </div>
  );
}
