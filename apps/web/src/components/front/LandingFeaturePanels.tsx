"use client";

import { DiscoverCard } from "@/components/playbooks/DiscoverCard";
import { ItineraryDayBlock } from "@/components/pages/blocks/ItineraryDayBlock";
import { SunBlock } from "@/components/pages/blocks/SunBlock";
import { TripPeopleBlock } from "@/components/pages/blocks/TripPeopleBlock";
import { TripStripBlock } from "@/components/pages/blocks/TripStripBlock";
import { FixedPeopleProvider } from "@/components/pages/people";
import { Segs } from "@/components/pages/WidgetSegs";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { LANDING_DEMO, LANDING_FEATURES } from "@/lib/landingDemo";
import { dayPath } from "@/lib/playbookUrls";
import { LANDING_ACCENTS, LANDING_RIVER_CITY, LANDING_RIVER_TITLE, LandingRiver, snapshotAccents } from "./LandingRiver";

// The sea's moments (M51) and the phone's claims, drawn by the product's own
// components (M42 part 9) from the committed snapshots (`lib/landingDemo.ts`).
//
// Loaded lazily by `LandingFeaturePanel`, which keeps the river's
// drag-and-drop and `@tc/pages` out of the landing's first load. Each panel
// carries its own surface, so a moment and a phone claim can hold the same one.

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
 * The sea's first moment: the Railay day as a big card, and the same day again
 * as a small one beside it (Mitchell, on C2: *"I love the bigger card on the
 * left, and the smaller detacted card being the same trip"*). Both open the
 * day's canonical page, as every cell of the sea does. The small one is a
 * background card: the same door again would be a second tab stop and a
 * second reading of one name.
 */
export function FindADayPanel(): React.ReactElement {
  const { shelf } = LANDING_FEATURES;
  const origin = { from: "sea", href: dayPath(shelf) } as const;
  return (
    <ul className="flex items-start gap-3">
      <DiscoverCard day={shelf} origin={origin} size="wide" headingLevel={3} className="flex-2" />
      <DiscoverCard
        day={{ ...shelf, cities: [], preview: [], tags: [] }}
        origin={{ ...origin, background: true }}
        headingLevel={3}
        className="flex-1"
      />
    </ul>
  );
}

const { crew } = LANDING_FEATURES;
const CREW_ACCENTS = snapshotAccents(crew.accents);
// Sixteen hours of Naxos in about 500px, so the moment stays near 600 and the
// sea shows around it (decision 10); a short stop keeps the board's floor height.
const CREW_PX_PER_HOUR = 32;

/**
 * The crew moment: the Greek trip's Day 2, Elena's borrowed Naxos day, on the
 * board's read-only river, under who is going. Inside the crew's own people,
 * so the stops name them as a trip's board does.
 */
export function CrewPanel(): React.ReactElement {
  return (
    <FixedPeopleProvider personas={crew.personas}>
      <div className={SURFACE}>
        <div className="flex flex-col gap-2 border-b border-hairline px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <Text as="span" className="font-display font-semibold">
              {`${crew.name} · Day ${crew.river.ordinal} · ${crew.river.city}`}
            </Text>
            <DataText className="ml-auto text-2xs tracking-wider uppercase">Timeline</DataText>
          </div>
          <TripPeopleBlock payload={crew.people} />
        </div>
        <div className="px-3.5 py-3">
          <LandingRiver day={crew.river} people={crew.personas} dayAccents={CREW_ACCENTS} dayCurrency={crew.currency} pxPerHour={CREW_PX_PER_HOUR} />
        </div>
      </div>
    </FixedPeopleProvider>
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

const PEOPLE_NAMES = new Intl.ListFormat("en", { type: "conjunction" });

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
 * about a day already lived. The chips are decorative (`PersonChip`), so
 * their names are said beside them, to a screen reader only: printing them
 * would be copy nobody ruled on.
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
      <span className="sr-only">{PEOPLE_NAMES.format(people.stack.map((person) => person.name))}</span>
    </div>
  );
}
