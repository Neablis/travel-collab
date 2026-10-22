"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactElement } from "react";
import Link from "next/link";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { Transcript, toolNoteLabel, type AssistantTurn } from "@/components/assistant/Transcript";
import { BrandMark } from "@/components/BrandMark";
import type { BoardSuggestions } from "@/components/board/DayRiver";
import { StopTagChips } from "@/components/board/StopTagChips";
import { SuggestionReviewList } from "@/components/board/SuggestionReviewList";
import { ratingLine } from "@/components/playbooks/DiscoverCard";
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
import { cn } from "@/lib/cn";
import { LANDING_DEMO, LANDING_FEATURES } from "@/lib/landingDemo";
import { dayPath } from "@/lib/playbookUrls";
import { toClockLabel, toClockRange } from "@/lib/time";
import { LANDING_ACCENTS, LandingRiver, snapshotAccents } from "./LandingRiver";

// The sea's moments (M51), on the desktop and the phone alike, drawn by the
// product's own components (M42 part 9) from the committed snapshots
// (`lib/landingDemo.ts`). Each fills the moment's cell, whose size the sea's
// grid gives it: on a phone a cell is the screen's width and three units tall.
//
// Loaded lazily by `LandingFeaturePanel`, which keeps the river's
// drag-and-drop and `@tc/pages` out of the landing's first load.

const SURFACE = "overflow-hidden rounded-lg border border-hairline bg-surface";

// The sea's first moment (M9) is the Rome day as the day page shows it
// (`SharedDayScreen`), not a repeat of the small cards: the title, its meta
// line, its tag chips, the warm description, one day's timeline, what people
// said, and who kept it. The title is the one door into the day, as before.
// No map: the day page's MapLibre map is an external rate-limited library
// and stays off the homepage. No transit legs between the timeline's stops:
// the canned snapshot carries no leg data (the day page computes them), so
// none are invented here — the rows are times and stop names only. The
// description is the Rome day's own, as its day page shows it, kept as panel
// copy because the canned snapshot carries no narrative paragraph; when the
// snapshot gains one, swap this in for it. The meta line follows the day
// page's own format, and `keptIn` its wording (Month Year, UTC); it is kept
// local so the landing bundle does not pull in the day screen.
const keptIn = (createdAt: string): string => {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return "Not known";
  return at.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};
/** The Rome day's own description, as its day page shows it (see the panel comment). */
const FIND_A_DAY_BLURB =
  "Rome as a city built on top of itself: the Colosseum and Forum, the Pantheon and the baroque piazzas, then out past the walls to the Baths of Caracalla and the catacombs under the Appian Way. Ancient history you can walk through, with Trastevere and Testaccio dinners to recover in.";
/**
 * How many of the day's tags the panel shows: the description plus this
 * many chips fit one line at every panel width (desktop and phone), so the
 * row never wraps. The full list stays in the snapshot's data; only the
 * display is shortened (Mitchell's preview feedback: shorten the tag list
 * so Sightseeing sits on the same line as the tags).
 */
const FIND_A_DAY_TAGS_SHOWN = 3;
/**
 * PLACEHOLDER reviews, to be replaced when a better example exists: sample
 * quotes that make the day read used and real, grounded in its actual stops
 * (the Colosseum, Testaccio, the Appian Way). These are not real user
 * reviews. Keep them in this one constant so replacing them is one edit.
 */
const SAMPLE_REVIEWS: { name: string; quote: string }[] = [
  { name: "Elena", quote: "The arena floor first thing was worth every cent — standing where the gladiators stood changes the whole place." },
];
/**
 * Whether the find panel's day block overflows the height the moment
 * leaves it: the timeline earns its bottom fade exactly when its content
 * runs past that height. The 1px tolerance absorbs subpixel rounding, so
 * a hairline rounding difference never fades a fitting timeline. Pure so
 * the rule is unit-testable: jsdom reports no real layout.
 */
export function dayBlockOverflows(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight > clientHeight + 1;
}

/**
 * The sea's first moment (M9): the Rome day as the day page shows it, not a
 * repeat of the small cards. Returns the notebook-style panel: title, meta
 * line, tag chips, description, one day's timeline, what people said, and
 * who kept it.
 *
 * Layout contract (Mitchell's follow-up to the preview feedback): the
 * panel is a full-height flex column whose day block is the flexible
 * middle (`flex-1 min-h-0 overflow-hidden`) and whose reviews block is
 * pinned at the foot (`mt-auto shrink-0`), so the review is never the
 * thing that clips. The day block's bottom fade is conditional — it
 * appears exactly when the timeline overflows its flexed height, never
 * when the rows fit whole.
 */
export function FindADayPanel(): React.ReactElement {
  const { shelf } = LANDING_FEATURES;
  const clock = useTimeFormat();
  const rated = ratingLine(shelf);
  const dayRef = useRef<HTMLDivElement>(null);
  const [dayOverflows, setDayOverflows] = useState(false);
  // The fade is state-gated, not always-on: measure the day block's own
  // overflow (its box is fixed by flex, so a content change alone does not
  // move it — re-check on viewport resizes, element resizes, and font
  // loads, the three ways its overflow can change).
  useEffect(() => {
    const el = dayRef.current;
    if (el === null) return;
    const update = () => {
      const next = dayBlockOverflows(el.scrollHeight, el.clientHeight);
      setDayOverflows((prev) => (prev === next ? prev : next));
    };
    update();
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (ro !== null) ro.observe(el);
    if (typeof document !== "undefined" && document.fonts !== undefined) {
      void document.fonts.ready.then(update).catch(() => undefined);
    }
    return () => {
      window.removeEventListener("resize", update);
      if (ro !== null) ro.disconnect();
    };
  }, []);
  const meta = [
    shelf.dayCount > 1 ? `${shelf.dayCount} days` : null,
    `${shelf.stopCount} stops`,
    `kept in ${keptIn(shelf.createdAt)}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <div data-testid="find-a-day-panel" className="landing-sea-cell flex min-h-0 flex-1 flex-col gap-2">
      <Heading level={3} className="shrink-0 text-md font-medium leading-snug">
        <Link href={dayPath(shelf)} prefetch={false} className="hover:underline">
          {shelf.name}
        </Link>
      </Heading>
      <DataText size="xs" className="block shrink-0">
        {shelf.cities.join(", ")}
      </DataText>
      <DataText size="xs" className="block shrink-0">
        {meta}
      </DataText>
      {(shelf.description !== null || shelf.tags.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2" data-testid="find-a-day-tags">
          {shelf.description !== null && <Text variant="secondary">{shelf.description}</Text>}
          {shelf.tags.length > 0 && <StopTagChips activityId={shelf.savedDayId} tags={shelf.tags.slice(0, FIND_A_DAY_TAGS_SHOWN)} focusedTag={null} />}
        </div>
      )}
      <Text as="p" className="line-clamp-2 shrink-0 text-sm leading-relaxed text-pretty">
        {FIND_A_DAY_BLURB}
      </Text>
      {/* The canned preview is Day 1's stops (its times and names match the day page's Day 1; the generator's SHELF_DAY picks it, and Day 1's four stops fit the moment where Day 2's six did not). The rows mirror the day page's stop rows — time gutter, numbered marker, title — tightened to pt-1.5/pb-0.5; no leg lines, because the snapshot carries no leg data and none are invented. The hairline under the day line and the dividers between rows are the day page's own hairline token, as Mitchell's preview feedback asked for. This block is the panel's flexible middle: it takes whatever height the moment leaves after the header, blurb, and footer, and clips the rest — with its bottom fade (`landing-find-day-fade`) applied exactly when its content runs past that height, so the rows dissolve instead of cutting mid-row. */}
      <div
        ref={dayRef}
        data-testid="find-a-day-day"
        className={cn("flex min-h-0 flex-1 flex-col gap-1 overflow-hidden", dayOverflows && "landing-find-day-fade")}
      >
        <DataText size="xs" className="uppercase tracking-wider">
          Day 1 · {shelf.preview.length} stops
        </DataText>
        <span aria-hidden data-testid="find-a-day-separator" className="h-px bg-hairline" />
        <ul data-testid="find-a-day-timeline" className="flex flex-col divide-y divide-hairline">
          {shelf.preview.map((stop, index) => (
            <li key={index}>
              <div className="flex gap-2.5 pt-1.5 pb-0.5 md:gap-3">
                <DataText size="xs" className="w-15.5 shrink-0 pt-0.5 text-2xs md:w-21.5">
                  {stop.start !== null ? toClockLabel(stop.start, clock) : ""}
                </DataText>
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-brand font-mono text-2xs font-semibold text-surface"
                  data-testid="stop-number"
                >
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-px">
                  <span className="truncate font-semibold text-ink">{stop.title}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto flex shrink-0 flex-col gap-1.5" data-testid="find-a-day-footer">
        <div className="flex items-baseline gap-2">
          <Heading level={4} className="text-sm font-semibold">
            What people said
          </Heading>
          {rated !== null && (
            <span className="text-xs">
              <span aria-hidden className="text-warning">
                ★
              </span>{" "}
              <span className="font-semibold text-ink">{rated}</span>
            </span>
          )}
        </div>
        <ul className="flex flex-col gap-1.5">
          {SAMPLE_REVIEWS.map((review) => (
            <li key={review.name} className="flex flex-col" data-testid="find-a-day-review">
              <Text as="span" className="line-clamp-1 text-sm leading-snug">
                “{review.quote}”
              </Text>
              <Text as="span" variant="muted" className="text-xs">
                — {review.name}
              </Text>
            </li>
          ))}
        </ul>
        {/* The attribution hides on phones: it is the panel's last line, so
            on a narrow phone moment it is the line that half-clips below the
            activities (Mitchell's preview feedback: text peeking out from
            under the day activities on mobile — the cut falls in the
            reviews block's tail, not the notebook description, which sits
            mid-panel). Day 1's four stops and the shortened tag list
            already fit phones 375px and up; hiding this line covers the
            350–366px band too. */}
        <Text as="span" className="text-xs max-md:hidden">
          By {shelf.ownerDisplayName}
        </Text>
      </div>
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
 * it read the trip and the day, the borrowed playbook the suggestions come
 * from, and drafted one change per stop it suggests.
 * Not `find_free_time`, whose note says "free", a word the front door does
 * not use (SPEC §14).
 */
const ASSISTANT_STEPS: [tool: string, input: unknown][] = [
  ["read_trip", {}],
  ["read_day", { days: [assistant.river.ordinal] }],
  ["read_playbook", {}],
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
const ASSISTANT_REVIEW = "Accept them all here, or decide each on the day.";
const ASSISTANT_DAY = `Day ${assistant.river.ordinal}`;
type AssistantGhost = (typeof assistant.ghosts)[number];
/**
 * A button as the app draws it, as a picture: a `span`, so nothing to press,
 * focus or announce, and out of hit-testing with the arrow cursor, so it shows
 * no hover colour and no hand (Mitchell's walk of PR 514: *"I don't think it
 * makes sense for the assistant preview buttons to be clickable"*).
 */
const still = (variant: "primary" | "secondary") => cn(buttonVariants({ variant, size: "sm" }), "pointer-events-none cursor-default");

/**
 * The open popover, as the board draws one standing open below its ghost, over
 * the stops after it: the change's sentence over Accept, Dismiss and Withdraw.
 * As wide as the lane, not the app's portalled 320px: at 1100 the lane is some
 * 250px and the river's surface would cut the rest off.
 */
function StillReview({ ghost }: { ghost: AssistantGhost }): React.ReactElement {
  return (
    <div role="group" aria-label="Review this suggestion" className={cn(POPOVER_SURFACE, "relative z-10 mt-1.5 w-full")}>
      <SuggestionReviewList
        ghosts={[ghost]}
        actions={() => (
          <div className="flex flex-wrap gap-1.5">
            <span className={still("primary")}>Accept</span>
            <span className={still("secondary")}>Dismiss</span>
            <span className={still("secondary")}>Withdraw</span>
          </div>
        )}
      />
    </div>
  );
}

/**
 * The ghosts on the river as the board lays them, each wrapped as the board
 * wraps one, a picture of its button rather than a button. The last, so its
 * popover hangs below the day's suggestions rather than over the next one,
 * stands with that popover open (Mitchell's walk of PR 514: *"Include the
 * overview on one of the items for accept/dismiss/withdraw"*). Drawn in the
 * river rather than in a portal, so it rises, fades and scrolls with the
 * moment.
 */
const ASSISTANT_SUGGESTIONS: BoardSuggestions = {
  days: new Map([[assistant.river.dayId, assistant.ghosts]]),
  stops: new Map(),
  newDays: [],
  review: (ghosts, trigger) => {
    const { variant, className, children, "aria-label": label } = (trigger as ReactElement<ComponentProps<typeof Button>>).props;
    const open = assistant.ghosts.at(-1);
    return (
      <>
        <div role="img" aria-label={label} className={cn(buttonVariants({ variant }), className, "pointer-events-none cursor-default")}>
          {children}
        </div>
        {open !== undefined && ghosts[0] === open && <StillReview ghost={open} />}
      </>
    );
  },
  actions: () => null,
};

/** The rail's two tabs, as `AssistantRail` names them, with Ask selected. */
const RAIL_TABS = [
  { label: "Chat", selected: false },
  { label: "Ask", selected: true },
];

/**
 * The assistant moment (Mitchell, 2026-10-21: *"make it about the ai
 * assistant, since that feature isnt really talked about right now … a
 * example of a fake AI bot assistant and the approve ghost changes ui we
 * built"*), drawn as the app draws its assistant (his walk of PR 514, beside a
 * screenshot of the real panel): the panel's head, its Chat and Ask tabs on
 * Ask, and the line saying what it is looking at; the app's own transcript,
 * asking for more of the Rome trip's Day 1, with the steps the turn took
 * open, the answer, and the note of the suggestion it stored (ADR-067)
 * with *Accept all*. Beside it, the day under a stack of what is being added,
 * and the board's own river drawing the same stops as ghosts, one with its
 * popover open.
 *
 * A still picture of all that, not a working copy: every control is drawn and
 * none is there, so a screen reader hears one figure, named for what it shows,
 * and Tab passes it by. Canned (`landingFeatures.generated.json`), so `/`
 * fetches nothing (ADR-078).
 *
 * In a cell too narrow for two columns, a phone's, the day alone: its stack
 * of what is being added and its ghosts say what was asked for, and the
 * river runs on past the cell's foot, faded there.
 */
export function AssistantPanel(): React.ReactElement {
  const clock = useTimeFormat();
  return (
    <figure aria-label="An example: the assistant suggests two stops for Day 1" className="@container grid min-h-0 flex-1">
      <div aria-hidden className="grid min-h-0 gap-5 @sm:grid-cols-2">
        <div className={cn(SURFACE, "hidden min-h-0 min-w-0 flex-col @sm:flex")}>
          <div className="shrink-0 border-b border-hairline px-4 py-3">
            <div className="flex items-center gap-2">
              <BrandMark size={24} />
              <Text as="span" className="text-md font-semibold">
                Assistant
              </Text>
            </div>
            {/* `UnderlineTabs`' look, drawn: `-mb-px` sets the selected edge on the base line. */}
            <div className="mt-2 flex items-stretch gap-5.5 border-b border-hairline">
              {RAIL_TABS.map(({ label, selected }) => (
                <span
                  key={label}
                  className={cn(
                    "-mb-px inline-flex min-h-11 items-center border-b-2 px-px text-base fine:min-h-10",
                    selected ? "border-brand font-semibold text-ink" : "border-transparent font-medium text-slate",
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-2 rounded-sm bg-paper px-2.5 py-1.5 text-xs text-slate">{`Looking at ${assistant.trip}`}</div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-4 py-3.5">
            <Transcript turns={ASSISTANT_TURNS} example={{ review: ASSISTANT_REVIEW, stepsOpen: true }} />
          </div>
        </div>
        <div className={cn(SURFACE, "landing-phone-fade flex min-h-0 min-w-0 flex-col")}>
          <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-2.5">
            <Text as="span" className="font-display font-semibold">
              {`${assistant.trip} · ${ASSISTANT_DAY} · ${assistant.river.city}`}
            </Text>
            <DataText className="ml-auto text-2xs tracking-wider uppercase">Timeline</DataText>
          </div>
          {/* The stack of what is being added, over the day that shows them
              (Mitchell's walk of PR 514: *"Stack the changes with a simple
              overview of whats being added"*). */}
          <div className="flex flex-col gap-1.5 border-b border-hairline bg-brand-tint px-3.5 py-2.5">
            <Text as="span" className="text-xs font-semibold text-brand-pressed uppercase">
              Being added
            </Text>
            <ul aria-label="Suggestions being added" className="m-0 flex list-none flex-col gap-1 p-0">
              {assistant.ghosts.map((ghost) => (
                <li key={ghost.changeId} className="flex items-baseline gap-2 text-sm text-ink">
                  <DataText className="w-30 shrink-0 text-xs">
                    {toClockRange(ghost.activity!.timeWindow!.start, ghost.activity!.timeWindow!.end, clock)}
                  </DataText>
                  <span className="min-w-0 flex-1 truncate font-semibold">{ghost.activity!.title}</span>
                  <span className="shrink-0 text-xs text-slate">{ASSISTANT_DAY}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="px-3.5 py-3">
            <LandingRiver
              day={assistant.river}
              people={{}}
              dayAccents={ASSISTANT_ACCENTS}
              dayCurrency={assistant.currency}
              pxPerHour={ASSISTANT_PX_PER_HOUR}
              suggestions={ASSISTANT_SUGGESTIONS}
            />
          </div>
        </div>
      </div>
    </figure>
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
      {/* Filling its moment, whose height the sea's grid gives it; on a
          phone the day runs on past it, faded at its foot. */}
      <div className={cn(SURFACE, "landing-phone-fade flex min-h-0 flex-1 flex-col")}>
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
