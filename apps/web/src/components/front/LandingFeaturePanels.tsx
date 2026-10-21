"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactElement } from "react";
import { Transcript, type AssistantTurn } from "@/components/assistant/Transcript";
import type { BoardSuggestions } from "@/components/board/DayRiver";
import { ReviewButtons } from "@/components/board/ReviewButtons";
import { DiscoverCard } from "@/components/playbooks/DiscoverCard";
import { ItineraryDayBlock } from "@/components/pages/blocks/ItineraryDayBlock";
import { SunBlock } from "@/components/pages/blocks/SunBlock";
import { TripPeopleBlock } from "@/components/pages/blocks/TripPeopleBlock";
import { TripStripBlock } from "@/components/pages/blocks/TripStripBlock";
import { FixedPeopleProvider } from "@/components/pages/people";
import { Segs } from "@/components/pages/WidgetSegs";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
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
 * The sea's first moment: the richest Thailand day as a big card, filling the
 * moment, and opening the day's canonical page, as every cell of the sea does.
 * The days lit beside it are other Thai days, not this one again (Mitchell's
 * third walk of PR 510).
 */
export function FindADayPanel(): React.ReactElement {
  const { shelf } = LANDING_FEATURES;
  return (
    <div className="landing-sea-cell flex min-h-0 flex-1 flex-col">
      <DiscoverCard day={shelf} origin={{ from: "sea", href: dayPath(shelf) }} size="wide" headingLevel={3} className="min-h-0 flex-1" />
    </div>
  );
}

const { assistant } = LANDING_FEATURES;
const ASSISTANT_ACCENTS = snapshotAccents({ [assistant.river.dayId]: assistant.accent });
// Day 1's axis, nine to ten at night, filling its panel: the moment is at
// least the 690px `LandingSea`'s STORIES declares, which less its heading,
// the panel's head and padding leaves some 525px for thirteen hours. Whole
// rows can only make the moment taller, so the day never runs past its foot.
// (At the crew's 29px an hour a ghost's title and "Suggested" badge were
// clipped; at 40 a 90-minute stop holds both.)
const ASSISTANT_PX_PER_HOUR = 40;
const ASSISTANT_TURNS: AssistantTurn[] = [
  { id: "ask", role: "user", text: assistant.ask },
  { id: "answer", role: "assistant", text: assistant.answer, tools: [], pending: false, suggested: assistant.suggested },
];
/** The note's pointer: the board's suggestions chip is not on this page; the Accept and Dismiss under the note are. */
const ASSISTANT_EXAMPLE = { review: "Accept or dismiss each below. It is an example, so nothing is saved." };
type AssistantGhost = (typeof assistant.ghosts)[number];
type Decision = "accepted" | "dismissed";
/** `focusNext`'s mark for the reset button, which no change id is. */
const RESET = Symbol("reset");

/**
 * The pending ghosts on the river as the board lays them, each wrapped as the
 * board wraps one, but in no popover: here its Accept and Dismiss are listed
 * beside the day, so the ghost is a picture of one: drawn as the board's
 * button but not a button, which a screen reader could press to no effect
 * (PR 514 r2), and with no hover or pointer promising a popover.
 */
function assistantSuggestions(pending: readonly AssistantGhost[]): BoardSuggestions {
  return {
    days: new Map([[assistant.river.dayId, pending]]),
    stops: new Map(),
    newDays: [],
    review: (_ghosts, trigger) => {
      const { variant, className, children, "aria-label": label } = (trigger as ReactElement<ComponentProps<typeof Button>>).props;
      return (
        <div role="img" aria-label={label} className={cn(buttonVariants({ variant }), className, "pointer-events-none")}>
          {children}
        </div>
      );
    },
    actions: () => null,
  };
}

/** The demo day with the accepted ghosts as planned stops on it, as accepting one on the board makes it. */
function withAccepted(accepted: readonly AssistantGhost[]): typeof assistant.river {
  if (accepted.length === 0) return assistant.river;
  return {
    ...assistant.river,
    activityIds: [...assistant.river.activityIds, ...accepted.map((ghost) => ghost.activity!.activityId)],
    activities: { ...assistant.river.activities, ...Object.fromEntries(accepted.map((ghost) => [ghost.activity!.activityId, ghost.activity!])) },
  };
}

/**
 * The assistant moment (Mitchell, 2026-10-21: *"make it about the ai
 * assistant, since that feature isnt really talked about right now … a
 * example of a fake AI bot assistant and the approve ghost changes ui we
 * built"*). The app's own transcript, asking for more of the Rome trip's Day 1
 * and answering with stops it put on the board as a suggestion (ADR-067); the
 * board's own river drawing them as ghosts; and the reviewer's Accept and
 * Dismiss for each, which work (PR 514 r1, after Mitchell's *"two dropdowns
 * that dont work"*): Accept makes the ghost a planned stop on the river,
 * Dismiss takes it off, and a reset brings both back. Canned
 * (`landingFeatures.generated.json`) and decided in this component's state
 * alone, so `/` fetches nothing (ADR-078); the group says it is an example.
 */
export function AssistantPanel(): React.ReactElement {
  const [decided, setDecided] = useState<Readonly<Record<string, Decision>>>({});
  const [said, setSaid] = useState("");
  // Where focus goes once the button that held it has left the page: the next
  // pending suggestion's Accept (a change id), or the reset when none is left.
  const focusNext = useRef<string | typeof RESET | null>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (focusNext.current === RESET) resetRef.current?.focus();
    else if (focusNext.current !== null) listRef.current?.querySelector<HTMLElement>(`[data-change-id="${focusNext.current}"] button`)?.focus();
    focusNext.current = null;
  }, [decided]);
  const pending = assistant.ghosts.filter((ghost) => decided[ghost.changeId] === undefined);

  function decide(ghost: AssistantGhost, decision: Decision) {
    const at = pending.indexOf(ghost);
    const left = pending.filter((other) => other !== ghost);
    focusNext.current = (left[at] ?? left[at - 1])?.changeId ?? RESET;
    setDecided((was) => ({ ...was, [ghost.changeId]: decision }));
    setSaid(decision === "accepted" ? `Accepted: ${ghost.activity?.title} is on Day 1.` : `Dismissed: ${ghost.activity?.title}.`);
  }
  function reset() {
    focusNext.current = assistant.ghosts[0]!.changeId;
    setDecided({});
    setSaid("The suggestions are back.");
  }

  return (
    <div role="group" aria-label="An example: the assistant suggests two stops for Day 1" className="grid min-h-0 flex-1 grid-cols-2 gap-5">
      <div className="flex min-h-0 min-w-0 flex-col gap-4">
        <Transcript turns={ASSISTANT_TURNS} example={ASSISTANT_EXAMPLE} />
        {pending.length > 0 && (
          <ul ref={listRef} aria-label="Suggested changes" className="m-0 flex list-none flex-col gap-3 p-0">
            {pending.map((ghost) => (
              <li key={ghost.changeId} data-change-id={ghost.changeId} className="flex flex-col gap-1.5">
                {/* Pending, so not the change's own "Added …" sentence, which reads as done. */}
                <Text as="span" className="text-sm text-ink">
                  {`Suggested: ${ghost.activity?.title}`}
                </Text>
                <div className="flex flex-wrap gap-1.5">
                  <ReviewButtons
                    description={ghost.description}
                    accept={{ onClick: () => decide(ghost, "accepted") }}
                    dismiss={{ onClick: () => decide(ghost, "dismissed") }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {pending.length < assistant.ghosts.length && (
          <Button ref={resetRef} variant="secondary" size="sm" className="self-start" onClick={reset}>
            Show the suggestions again
          </Button>
        )}
        <p role="status" className="sr-only">
          {said}
        </p>
      </div>
      <div className={cn(SURFACE, "flex min-h-0 min-w-0 flex-col")}>
        <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-2.5">
          <Text as="span" className="font-display font-semibold">
            {`${assistant.trip} · Day ${assistant.river.ordinal} · ${assistant.river.city}`}
          </Text>
          <DataText className="ml-auto text-2xs tracking-wider uppercase">Timeline</DataText>
        </div>
        <div className="px-3.5 py-3">
          <LandingRiver
            day={withAccepted(assistant.ghosts.filter((ghost) => decided[ghost.changeId] === "accepted"))}
            people={{}}
            dayAccents={ASSISTANT_ACCENTS}
            dayCurrency={assistant.currency}
            pxPerHour={ASSISTANT_PX_PER_HOUR}
            suggestions={assistantSuggestions(pending)}
          />
        </div>
      </div>
    </div>
  );
}

const { crew } = LANDING_FEATURES;
const CREW_ACCENTS = snapshotAccents(crew.accents);
// Sixteen hours of Naxos in under 480px; a short stop keeps the board's floor
// height. The moment's cell is whole rows of the sea (680px declared in
// `LandingSea`'s STORIES), four at 1440: 700px (Mitchell's third walk of PR
// 510: *"Cut it one row shorter"*), and 32px an hour ran 18px past its foot.
const CREW_PX_PER_HOUR = 29;

/**
 * The crew moment: the Greek trip's Day 2, Elena's borrowed Naxos day, on the
 * board's read-only river, under who is going. Inside the crew's own people,
 * so the stops name them as a trip's board does.
 */
export function CrewPanel(): React.ReactElement {
  return (
    <FixedPeopleProvider personas={crew.personas}>
      {/* Filling its moment, whose height the sea's grid gives it. */}
      <div className={cn(SURFACE, "flex min-h-0 flex-1 flex-col")}>
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

const PAGE = "flex flex-col gap-3 rounded-md border border-hairline bg-paper px-3.75 py-3.5";

/** One of the page's paragraphs: the author's words with the widgets' values in them. */
function Paragraph({ segs, className = "text-sm" }: { segs: (typeof LANDING_FEATURES.memory)[number]; className?: string }): React.ReactElement {
  return (
    <Text as="p" className={cn("leading-relaxed text-pretty", className)}>
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
 * Notebook: a page as a notebook holds it once somebody has lived the day
 * (M50 part 9), written the way a real one is (Mitchell's third walk of PR
 * 510: *"too fake, not lived in enough … dont be afraid to make it too
 * long"*): the trip's strip, the page's title, the author's words at reading
 * size with the day's cities and stops in them, the notebook's own block
 * widgets — the day's stops at their times beside its daylight — then what
 * they would tell the next people and what they would change, under headings.
 * Read-only payloads drawn by the blocks directly, not through the editor's
 * dispatcher, so `/` stays static.
 *
 * Longer than its cell, and never growing it (the parent sizes, the component
 * fills): the page runs on past the cell's foot and fades out at that edge
 * (`.landing-sea-fade`).
 */
export function NotebookPagePanel(): React.ReactElement {
  const [opening, ...rest] = LANDING_FEATURES.memory;
  const { day, sun, sunTitle, journal } = LANDING_FEATURES.page;
  return (
    <div data-testid="notebook-page" className={cn(PAGE, "landing-sea-fade @container min-h-0 flex-1 gap-4 overflow-hidden rounded-b-none border-b-0 px-5 pt-5")}>
      <TripStripBlock payload={LANDING_DEMO.notebook.strip} accents={LANDING_ACCENTS} />
      <Heading level={3} className="text-2xl">
        {`Day ${day.ordinal} · ${day.cities.at(-1)}`}
      </Heading>
      {opening && <Paragraph segs={opening} className="text-md" />}
      {/* The day's stops beside its daylight once the page is wide enough for both (the prototype's `.cols`). */}
      <div className="grid items-start gap-5 @2xl:grid-cols-2">
        <ItineraryDayBlock payload={day} />
        <div className="flex min-w-0 flex-col gap-4">
          {/* Headed with the widget's own title, since its ribbon alone does
              not say what it is (Mitchell's fourth walk of PR 510). */}
          <section className="flex flex-col gap-2">
            <Heading level={4} className="text-sm font-semibold">
              {sunTitle}
            </Heading>
            <SunBlock payload={sun} accents={LANDING_ACCENTS} />
          </section>
          {rest.map((segs, i) => (
            <Paragraph key={i} segs={segs} className="text-md" />
          ))}
        </div>
      </div>
      {journal.map(({ heading, paragraphs }) => (
        <section key={heading} className="flex flex-col gap-3">
          <Heading level={4} className="text-lg">
            {heading}
          </Heading>
          {paragraphs.map((segs, i) => (
            <Paragraph key={i} segs={segs} className="text-md" />
          ))}
        </section>
      ))}
    </div>
  );
}
