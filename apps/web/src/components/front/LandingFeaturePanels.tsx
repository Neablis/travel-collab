"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactElement } from "react";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { Transcript, toolNoteLabel, type AssistantTurn } from "@/components/assistant/Transcript";
import { BrandMark } from "@/components/BrandMark";
import type { BoardSuggestions } from "@/components/board/DayRiver";
import { ReviewButtons, SuggestionReviewList } from "@/components/board/ReviewButtons";
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
import { POPOVER_SURFACE } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { UnderlineTabs, tabId, tabPanelId } from "@/components/ui/underline-tabs";
import { cn } from "@/lib/cn";
import { LANDING_DEMO, LANDING_FEATURES } from "@/lib/landingDemo";
import { dayPath } from "@/lib/playbookUrls";
import { toClockRange } from "@/lib/time";
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
// Day 1's axis, nine to ten at night, filling its panel under the stack of
// what is being added: the moment is at least the 690px `LandingSea`'s
// STORIES declares, which less its heading, the panel's head, the stack and
// padding leaves some 440px for thirteen hours, the open popover inside them.
// Whole rows can only make the moment taller, so the day never runs past its
// foot. (At the crew's 29px an hour a ghost's title and "Suggested" badge were
// clipped; at 33 a 90-minute stop holds both.)
const ASSISTANT_PX_PER_HOUR = 33;
/**
 * The tools the turn called, worded by the transcript's own `toolNoteLabel`:
 * it read the trip and the day, and drafted one change per stop it suggests.
 * Not `find_free_time`, whose note says "free", a word the front door does
 * not use (SPEC §14).
 */
const ASSISTANT_STEPS: [tool: string, input: unknown][] = [
  ["read_trip", {}],
  ["read_day", { days: [assistant.river.ordinal] }],
  ...assistant.ghosts.map((): [string, unknown] => ["AddActivity", {}]),
];
const ASSISTANT_TURNS: AssistantTurn[] = [
  { id: "ask", role: "user", text: assistant.ask },
  {
    id: "answer",
    role: "assistant",
    text: assistant.answer,
    tools: ASSISTANT_STEPS.map(([tool, input], i) => ({ id: `step-${i}`, label: toolNoteLabel(tool, input) })),
    pending: false,
    suggested: assistant.suggested,
  },
];
/** The note's pointer: the board's suggestions chip is not on this page; the day's open suggestion is. */
const ASSISTANT_REVIEW = "Accept them all here, or decide each on the day. It is an example, so nothing is saved.";
const ASSISTANT_DAY = `Day ${assistant.river.ordinal}`;
type AssistantGhost = (typeof assistant.ghosts)[number];
type Decision = "accepted" | "dismissed";
/** `focusNext`'s marks: the open suggestion's first button, or the reset. */
type FocusTarget = "review" | "reset";

/**
 * The pending ghosts on the river as the board lays them, each wrapped as the
 * board wraps one. A ghost is a picture of the board's button, not a button,
 * which a screen reader could press to no effect (PR 514 r2). One of them,
 * `open`, stands with its popover open beneath it, as the board's shows once
 * a ghost is pressed (Mitchell's walk of PR 514: *"Include the overview on one
 * of the items for accept/dismiss/withdraw"*): its sentence over Accept,
 * Dismiss and Withdraw. Drawn in the river rather than in a portal, so it
 * rises, fades and scrolls with the moment.
 */
function assistantSuggestions(pending: readonly AssistantGhost[], open: AssistantGhost | undefined, review: (ghost: AssistantGhost) => React.ReactNode): BoardSuggestions {
  return {
    days: new Map([[assistant.river.dayId, pending]]),
    stops: new Map(),
    newDays: [],
    review: (ghosts, trigger) => {
      const { variant, className, children, "aria-label": label } = (trigger as ReactElement<ComponentProps<typeof Button>>).props;
      return (
        <>
          <div role="img" aria-label={label} className={cn(buttonVariants({ variant }), className, "pointer-events-none")}>
            {children}
          </div>
          {ghosts[0] === open && open !== undefined && review(open)}
        </>
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

/** "A and B", as the status says the stops Accept all took. */
const AND = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * The assistant moment (Mitchell, 2026-10-21: *"make it about the ai
 * assistant, since that feature isnt really talked about right now … a
 * example of a fake AI bot assistant and the approve ghost changes ui we
 * built"*), drawn as the app draws its assistant (his walk of PR 514, beside a
 * screenshot of the real panel): the panel's head, its Ask tab and the line
 * saying what it is looking at; the app's own transcript, asking for more of
 * the Rome trip's Day 1, with the steps the turn took open beneath it, the
 * answer, and the note of the suggestion it stored (ADR-067) with *Accept
 * all*. Beside it, the day under a stack of what is being added, and the
 * board's own river drawing the same stops as ghosts, one with its popover
 * open.
 *
 * Every button works (PR 514 r1, after Mitchell's *"two dropdowns that dont
 * work"*): Accept makes the ghost a planned stop on the river, Dismiss takes
 * it off, Withdraw does what Dismiss does, since nobody here wrote it, Accept
 * all takes every one, and a reset brings them back. Canned
 * (`landingFeatures.generated.json`) and decided in this component's state
 * alone, so `/` fetches nothing (ADR-078); the group says it is an example.
 */
export function AssistantPanel(): React.ReactElement {
  const [decided, setDecided] = useState<Readonly<Record<string, Decision>>>({});
  const [said, setSaid] = useState("");
  const [tab, setTab] = useState<RailTab>("ask");
  const clock = useTimeFormat();
  // Where focus goes once the button that held it has left the page: the
  // suggestion opened next, or the reset when none is left.
  const focusNext = useRef<FocusTarget | null>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusNext.current === "reset") resetRef.current?.focus();
    else if (focusNext.current === "review") reviewRef.current?.querySelector<HTMLElement>("button")?.focus();
    focusNext.current = null;
  }, [decided]);
  const pending = assistant.ghosts.filter((ghost) => decided[ghost.changeId] === undefined);
  // The last one pending, so its popover hangs below the day's suggestions
  // rather than over the next one.
  const open = pending.at(-1);

  function decide(ghost: AssistantGhost, decision: Decision, said: string) {
    focusNext.current = pending.length > 1 ? "review" : "reset";
    setDecided((was) => ({ ...was, [ghost.changeId]: decision }));
    setSaid(said);
  }
  function acceptAll() {
    focusNext.current = "reset";
    setDecided((was) => ({ ...was, ...Object.fromEntries(pending.map((ghost) => [ghost.changeId, "accepted" as const])) }));
    const titles = AND.format(pending.map((ghost) => ghost.activity!.title));
    setSaid(`Accepted all: ${titles} ${pending.length === 1 ? "is" : "are"} on ${ASSISTANT_DAY}.`);
  }
  function reset() {
    focusNext.current = "review";
    setDecided({});
    setSaid("The suggestions are back.");
  }
  const review = (ghost: AssistantGhost) => {
    const title = ghost.activity!.title;
    return (
      // The popover's own panel, standing open below its ghost as the board
      // aligns one, over the stops after it.
      <div ref={reviewRef} role="group" aria-label="Review this suggestion" className={cn(POPOVER_SURFACE, "relative z-10 mt-1.5")}>
        <SuggestionReviewList
          ghosts={[ghost]}
          actions={() => (
            <div className="flex flex-wrap gap-1.5">
              <ReviewButtons
                description={ghost.description}
                accept={{ onClick: () => decide(ghost, "accepted", `Accepted: ${title} is on ${ASSISTANT_DAY}.`) }}
                dismiss={{ onClick: () => decide(ghost, "dismissed", `Dismissed: ${title}.`) }}
                withdraw={{ onClick: () => decide(ghost, "dismissed", `Withdrawn: ${title}.`) }}
              />
            </div>
          )}
        />
      </div>
    );
  };

  return (
    <div role="group" aria-label="An example: the assistant suggests two stops for Day 1" className="grid min-h-0 flex-1 grid-cols-2 gap-5">
      {/* The panel as the trip's rail draws it: its head, its Chat and Ask
          tabs, and on Ask the line saying what it looks at, then the
          conversation. Chat is the people's, and this example has none, so it
          says what the rail's says with no messages. */}
      <div className={cn(SURFACE, "flex min-h-0 min-w-0 flex-col")}>
        <div className="shrink-0 border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <BrandMark size={24} />
            <Text as="span" className="text-md font-semibold">
              {tab === "chat" ? "Chat" : "Assistant"}
            </Text>
          </div>
          <UnderlineTabs aria-label="Chat or Ask" idPrefix={RAIL_TABS_ID} value={tab} onValueChange={setTab} options={RAIL_TABS} hasPanel className="mt-2" />
          {tab === "ask" && <div className="mt-2 rounded-sm bg-paper px-2.5 py-1.5 text-xs text-slate">{`Looking at ${assistant.trip}`}</div>}
        </div>
        <div
          role="tabpanel"
          id={tabPanelId(RAIL_TABS_ID, tab)}
          aria-labelledby={tabId(RAIL_TABS_ID, tab)}
          className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-4 py-3.5"
        >
          {tab === "chat" ? (
            <p className="text-sm leading-relaxed text-slate">No messages yet. Say hello to the people on this trip.</p>
          ) : (
            <Transcript turns={ASSISTANT_TURNS} example={{ review: ASSISTANT_REVIEW, acceptAll: pending.length > 0 ? acceptAll : undefined }} />
          )}
        </div>
        <p role="status" className="sr-only">
          {said}
        </p>
      </div>
      <div className={cn(SURFACE, "flex min-h-0 min-w-0 flex-col")}>
        <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-2.5">
          <Text as="span" className="font-display font-semibold">
            {`${assistant.trip} · ${ASSISTANT_DAY} · ${assistant.river.city}`}
          </Text>
          <DataText className="ml-auto text-2xs tracking-wider uppercase">Timeline</DataText>
        </div>
        {/* The stack of what is being added, over the day that shows them
            (Mitchell's walk of PR 514: *"Stack the changes with a simple
            overview of whats being added"*). */}
        {/* The reset is here, beside what it brings back, so either tab reaches it. */}
        <div className="flex flex-col gap-1.5 border-b border-hairline bg-brand-tint px-3.5 py-2.5">
          {pending.length > 0 && (
            <>
              <Text as="span" className="text-xs font-semibold text-brand-pressed uppercase">
                Being added
              </Text>
              <ul aria-label="Suggestions being added" className="m-0 flex list-none flex-col gap-1 p-0">
                {pending.map((ghost) => (
                  <li key={ghost.changeId} className="flex items-baseline gap-2 text-sm text-ink">
                    <DataText className="w-30 shrink-0 text-xs">
                      {toClockRange(ghost.activity!.timeWindow!.start, ghost.activity!.timeWindow!.end, clock)}
                    </DataText>
                    <span className="min-w-0 flex-1 truncate font-semibold">{ghost.activity!.title}</span>
                    <span className="shrink-0 text-xs text-slate">{ASSISTANT_DAY}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {pending.length < assistant.ghosts.length && (
            <Button ref={resetRef} variant="secondary" size="sm" className="self-start" onClick={reset}>
              Show the suggestions again
            </Button>
          )}
        </div>
        <div className="px-3.5 py-3">
          <LandingRiver
            day={withAccepted(assistant.ghosts.filter((ghost) => decided[ghost.changeId] === "accepted"))}
            people={{}}
            dayAccents={ASSISTANT_ACCENTS}
            dayCurrency={assistant.currency}
            pxPerHour={ASSISTANT_PX_PER_HOUR}
            suggestions={assistantSuggestions(pending, open, review)}
          />
        </div>
      </div>
    </div>
  );
}

/** The rail's two tabs, as `AssistantRail` names them. */
type RailTab = "chat" | "ask";
const RAIL_TABS_ID = "landing-assistant";
const RAIL_TABS: { value: RailTab; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "ask", label: "Ask" },
];

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
