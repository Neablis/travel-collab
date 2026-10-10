import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";

// The landing page's four feature blocks — Playbooks, Together, Countdown,
// Notebook, in that order. Three are transcribed from
// `.design-sync/handoff/design/Trip Planner Redesign.dc.html:2016-2199`
// (`data-r="lhowgrid"`); their words, the order, and the whole Countdown block
// are Mitchell's retro of 2026-09-28 (DRIFT D21,
// `docs/design-feedback/2026-09-28-landing-retro-copy.md`), which the design
// file does not carry yet. Each block's title is the section's <h2> — there is
// no heading above the grid any more. The section padding belongs to
// `LandingScreen.tsx`; this file renders the grid and nothing else.
//
// A server component on purpose: there is no state and no interaction in here,
// so it must not acquire `"use client"`. Every value is a fixture declared
// below — SPEC §14, the front door runs on nothing and a data-model change must
// never be able to break it.
//
// Nothing here is wrapped in `<Preview>`, deliberately. DRIFT §2: the Notebook's
// macro values and Playbooks sharing are unbuilt, and the landing page states
// direction rather than what shipped today. Only the two *interactive* dead ends
// get shells, and `LandingScreen.tsx` owns both.

const CREW = ["SK", "PR", "JM", "MT"] as const;

// `dc.html:2124-2133`. The design labels the total $550 ($340 + $210); SPEC §14
// says $596. The design file wins on copy (handoff `README.md`) and is the one
// that adds up — do not "fix" this to $596.
const COST_ROWS = [
  { item: "Ryokan, Higashiyama", who: "Priya", cost: "$340" },
  { item: "Kikunoi Roan dinner", who: "All 4", cost: "$210" },
] as const;
const COST_TOTAL = "$550";

// The Countdown block's steps. A fixture frozen the night before, never computed
// from `Date.now()`: the page runs on nothing (SPEC §14), and a clock read here
// would also render one thing on the server and another after hydration.
const COUNTDOWN_STEPS = [
  { label: "One month", done: true },
  { label: "One week", done: true },
  { label: "Tomorrow", done: false },
] as const;

// `dc.html:2166-2185`.
const PLAYBOOK_STOPS = [
  { time: "6:40a", stop: "Sunrise, Freedom Beach" },
  { time: "11:00a", stop: "Longtail to Ko Racha" },
  { time: "3:30p", stop: "Mango sticky rice, shade" },
  { time: "6:15p", stop: "Grilled snapper, Rawai" },
  { time: "8:00p", stop: "Night swim, Kata" },
] as const;

// The two dimmed days the borrowed beach day drops between (`dc.html:2155-2164`,
// `:2187-2194`). `bars` are ornamental stubs standing in for a day's stops; the
// design's 70/85/60% widths snap to the nearest fraction utility.
const JUNGLE_DAYS = [
  { day: "Day 1", title: "Khao Sok jungle", bars: ["w-full", "w-2/3", "w-5/6"] },
  { day: "Day 3", title: "Jungle trek", bars: ["w-full", "w-3/5"] },
] as const;

// Name chips are smaller and tighter than `Badge` and two of the three invert to
// solid brand, which no Badge variant carries — the shared shape lives here so
// the three don't drift apart.
const NAME_CHIP = "flex-none rounded-full px-1.5 py-0.5 text-3xs font-semibold tracking-wider uppercase";

// The design draws the timeline as `grid-template-columns: 40px 18px 1fr`, which
// Tailwind can't name; a flex row with fixed leading columns is the same layout
// and needs no inline style. The spine below is centred on the dot column:
// 40px + 6px gap + half of 18px = 55px = `left-13.75`.
const TIME_COLUMN = "w-10 shrink-0 text-right text-2xs";
const DOT_COLUMN = "flex w-4.5 shrink-0 justify-center";

function TimelineRow({ time, timeClassName, dot, children }: {
  time: string;
  timeClassName?: string;
  dot: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 py-1.5">
      <DataText className={cn(TIME_COLUMN, timeClassName)}>{time}</DataText>
      <span className={DOT_COLUMN}>{dot}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.75">{children}</div>
    </div>
  );
}

function TravelGap({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5 py-0.5">
      <span className="w-10 shrink-0" />
      <span className="w-4.5 shrink-0" />
      <DataText className="text-3xs">{children}</DataText>
    </div>
  );
}

function BlockHead({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.75 p-4.5 pb-3">
      <DataText className="text-2xs tracking-widest text-brand-pressed uppercase">{eyebrow}</DataText>
      <Heading level={2}>{title}</Heading>
      <Text as="p" variant="secondary" className="leading-normal text-pretty">
        {children}
      </Text>
    </div>
  );
}

// The jungle days recede behind the borrowed day, but only their DECORATION
// fades. `opacity-75` used to sit on the whole card, which also dimmed its text:
// slate on paper is 5.53:1, and at 75% opacity it composited down to 3.25:1 at
// 9.5px, so axe failed the day label on `/`. The card's
// paper-on-surface and the bars already read as background; the text keeps its
// full token colour.
function JungleDay({ day, title, bars }: { day: string; title: string; bars: readonly string[] }) {
  return (
    <div className="flex w-15.5 flex-none flex-col gap-1.25 rounded-md border border-hairline bg-paper px-1.75 py-2">
      <DataText className="text-3xs tracking-wider uppercase">{day}</DataText>
      <Text as="span" className="text-2xs">{title}</Text>
      {bars.map((width, i) => (
        <span key={i} aria-hidden className={cn("pointer-events-none h-1 rounded-full bg-success-tint opacity-75", width)} />
      ))}
    </div>
  );
}

export function LandingFeatureBlocks(): React.ReactElement {
  return (
    // Two columns from `lg`, not three or four. Four at the old three-column
    // width would squeeze the Playbooks card's borrowed Day 2 to nothing: at
    // three columns it already had only 137px of the ~300px card after the two
    // fixed 62px jungle days (CodeRabbit, PR #58), and a quarter-width card
    // leaves it none. One column below `lg`.
    <div className="grid gap-4.5 lg:grid-cols-2">
      {/* Playbooks — `dc.html:2138-2198` */}
      <Card className="flex h-full min-h-107.5 flex-col overflow-hidden rounded-lg p-0">
        <BlockHead eyebrow="Playbooks" title="Relive someone’s perfect day.">
          Every playbook is a day that actually happened, saved by the person who lived it, in the order
          it happened. The sunrise, the alley, the swim. Drop it into your trip and it&rsquo;s yours now.
        </BlockHead>

        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2.5 px-4.5 pb-4.5">
          <div className="flex items-center gap-2.25 rounded-lg border border-hairline bg-surface px-2.5 py-2.25">
            <span className="grid size-7.5 flex-none place-items-center rounded-full bg-warning-tint text-3xs font-semibold text-warning-ink">
              ML
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <Text as="span" className="text-xs font-semibold">A perfect Phuket beach day</Text>
              <div className="flex items-center gap-1.75">
                <span className="flex items-center gap-0.75">
                  <span aria-hidden className="pointer-events-none text-warning-ink">★</span>
                  <DataText className="text-2xs font-semibold text-ink">4.8</DataText>
                </span>
                <span aria-hidden className="pointer-events-none size-0.75 rounded-full bg-border-strong" />
                <Text as="span" variant="secondary" className="text-2xs">Relived 214 times</Text>
              </div>
            </div>
            <Text as="span" variant="secondary" className="ml-auto flex-none text-2xs">Malee</Text>
          </div>

          {/* `62px 1fr 62px`, as flex so the fixed columns need no inline grid
              template. The borrowed day is mid-drop between the jungle days. */}
          <div className="flex items-stretch gap-1.75">
            <JungleDay {...JUNGLE_DAYS[0]} />

            <div className="flex min-w-0 flex-1 -rotate-1 flex-col gap-1.25 rounded-md border-2 border-brand border-dashed bg-brand-tint px-2.25 py-2 shadow-lifted">
              <div className="flex items-center gap-1.5">
                <DataText className="text-3xs tracking-wider text-brand-pressed uppercase">Day 2</DataText>
                <span className={cn(NAME_CHIP, "ml-auto bg-brand text-surface")}>Phuket</span>
              </div>
              <div className="flex flex-col gap-1 rounded-sm bg-surface px-2 py-1.75">
                {PLAYBOOK_STOPS.map(({ time, stop }) => (
                  <div key={time} className="flex items-center gap-1.75">
                    <DataText className="text-3xs">{time}</DataText>
                    <Text as="span" className="text-2xs">{stop}</Text>
                  </div>
                ))}
              </div>
            </div>

            <JungleDay {...JUNGLE_DAYS[1]} />
          </div>
        </div>
      </Card>

      {/* Together — `dc.html:2018-2093` */}
      <Card className="flex h-full min-h-107.5 flex-col overflow-hidden rounded-lg p-0">
        <BlockHead eyebrow="Together" title="The trip starts before the trip.">
          One plan your whole group can touch. Drag a stop and watch everyone react. Tap the ones you
          can&rsquo;t wait for. Argue about Pontocho now, thank yourselves in Kyoto.
        </BlockHead>

        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2.5 px-4.5 pb-4.5">
          <div className="flex items-center gap-2">
            <div className="flex">
              {CREW.map((initials) => (
                <span
                  key={initials}
                  className="-ml-1.5 grid size-5.25 place-items-center rounded-full border-2 border-surface bg-brand-tint text-3xs font-semibold text-brand-pressed"
                >
                  {initials}
                </span>
              ))}
            </div>
            <DataText className="text-3xs tracking-wider uppercase">4 here now</DataText>
          </div>

          <div className="relative flex flex-col">
            <span aria-hidden className="pointer-events-none absolute top-2.5 bottom-2.5 left-13.75 w-px bg-hairline" />

            <TimelineRow
              time="9:40 am"
              dot={<span aria-hidden className="pointer-events-none size-1.75 rounded-full bg-brand ring-3 ring-surface" />}
            >
              <Text as="span" className="truncate text-xs">Fushimi Inari, early</Text>
              <span className={cn(NAME_CHIP, "bg-brand-tint text-brand-pressed")}>Sam</span>
              {/* "Tap the ones you can't wait for" — three of the four did. */}
              <span className="ml-auto flex flex-none items-center gap-0.5">
                <span role="img" aria-label="Can't wait" className="text-2xs text-danger">♥</span>
                <DataText className="text-3xs">3</DataText>
              </span>
            </TimelineRow>

            <TravelGap>Train + 20 min walk</TravelGap>

            <TimelineRow
              time="1:15 pm"
              dot={<span aria-hidden className="pointer-events-none size-1.75 rounded-full bg-brand ring-3 ring-surface" />}
            >
              <Text as="span" className="truncate text-xs">Nishiki Market</Text>
              <Badge variant="warning" className="flex-none px-1.5 text-3xs tracking-wider uppercase">Pending</Badge>
            </TimelineRow>

            <TravelGap>45 min on foot</TravelGap>

            {/* Priya's stop, lifted — the one that just moved. */}
            <TimelineRow
              time="4:00 pm"
              timeClassName="text-brand-pressed"
              dot={<span aria-hidden className="pointer-events-none size-2.25 rounded-full bg-brand ring-3 ring-brand-tint" />}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-brand bg-surface px-2.25 py-1.75 shadow-float">
                <Text as="span" className="truncate text-xs font-semibold">Ryokan check-in</Text>
                <span className={cn(NAME_CHIP, "ml-auto bg-brand text-surface")}>Priya</span>
              </div>
            </TimelineRow>

            <TimelineRow
              time="5:30 pm"
              dot={
                <span
                  aria-hidden
                  className="pointer-events-none size-1.75 rounded-full border-2 border-brand border-dashed bg-surface"
                />
              }
            >
              <Text as="span" variant="secondary" className="truncate text-xs">Pontocho, maybe</Text>
              <Badge variant="neutral" className="flex-none px-1.5 text-3xs tracking-wider uppercase">Idea</Badge>
            </TimelineRow>
          </div>

          <div className="flex items-start gap-2 rounded-md bg-moss px-2.75 py-2.25">
            <span className="grid size-5 flex-none place-items-center rounded-full bg-warning-tint text-3xs font-semibold text-warning-ink">
              DK
            </span>
            <div className="flex flex-col gap-0.5">
              <Text as="span" className="text-xs">
                “Keep Pontocho — we can decide on the night.”
              </Text>
              <DataText className="text-3xs tracking-wider uppercase">Dana · 2 replies</DataText>
            </div>
          </div>
        </div>
      </Card>

      {/* Countdown — new in the 2026-09-28 retro; no design artboard yet. */}
      <Card className="flex h-full min-h-107.5 flex-col overflow-hidden rounded-lg p-0">
        <BlockHead eyebrow="Countdown" title="Too excited to sleep.">
          Every trip gets a living countdown, shared with the whole group. One month. One week. Wheels
          up tomorrow. Sleep if you can.
        </BlockHead>

        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2.5 px-4.5 pb-4.5">
          <div className="flex items-center gap-2">
            <DataText className="text-3xs tracking-wider uppercase">Kyoto · Apr 4</DataText>
            <div className="ml-auto flex">
              {CREW.map((initials) => (
                <span
                  key={initials}
                  className="-ml-1.5 grid size-5.25 place-items-center rounded-full border-2 border-surface bg-brand-tint text-3xs font-semibold text-brand-pressed"
                >
                  {initials}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center gap-1 rounded-md border border-hairline bg-paper px-3.75 py-5">
            <DataText className="text-4xl font-semibold text-ink">1</DataText>
            <DataText className="text-2xs tracking-widest uppercase">day to go</DataText>
            <Text as="span" className="pt-1.5 font-display text-lg font-semibold">
              Wheels up tomorrow.
            </Text>
          </div>

          <ol className="flex items-center gap-1.5">
            {COUNTDOWN_STEPS.map(({ label, done }) => (
              <li key={label} className="flex min-w-0 flex-1 flex-col gap-1">
                <span
                  aria-hidden
                  className={cn("pointer-events-none h-1 rounded-full", done ? "bg-brand" : "bg-brand-tint")}
                />
                <DataText className={cn("truncate text-3xs tracking-wider uppercase", done ? null : "text-brand-pressed")}>
                  {label}
                </DataText>
              </li>
            ))}
          </ol>

          <div className="flex items-start gap-2 rounded-md bg-moss px-2.75 py-2.25">
            <span className="grid size-5 flex-none place-items-center rounded-full bg-brand-tint text-3xs font-semibold text-brand-pressed">
              PR
            </span>
            <div className="flex flex-col gap-0.5">
              <Text as="span" className="text-xs">
                “Bags are by the door. Is anyone else still up?”
              </Text>
              <DataText className="text-3xs tracking-wider uppercase">Priya · 1:12 am · 3 replies</DataText>
            </div>
          </div>
        </div>
      </Card>

      {/* Notebook — `dc.html:2095-2136` */}
      <Card className="flex h-full min-h-107.5 flex-col overflow-hidden rounded-lg p-0">
        <BlockHead eyebrow="Notebook" title="How you’ll remember it.">
          Pages that read like the letter home, with times and costs pulled live from the plan. Before
          the trip it&rsquo;s a promise. After, it&rsquo;s the keepsake.
        </BlockHead>

        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2.5 px-4.5 pb-4.5">
          <div className="flex items-center gap-2 pb-0.75">
            <DataText className="text-3xs tracking-wider uppercase">Arriving in Kyoto · Day 6</DataText>
            <DataText className="ml-auto text-3xs">Sam typing…</DataText>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-md border border-hairline bg-paper px-3.75 py-3.5">
            <Text as="p" className="text-sm leading-relaxed text-pretty">
              We land at{" "}
              <DataText className="rounded-sm bg-brand-tint px-1.25 py-px text-2xs text-brand-pressed">11:20 am</DataText>{" "}
              and head up to Higashiyama — bags at the ryokan by{" "}
              <DataText className="rounded-sm bg-brand-tint px-1.25 py-px text-2xs text-brand-pressed">4:00 pm</DataText>.{" "}
              <span className="border-b-2 border-warning bg-warning-tint px-0.5 py-px">
                Cash for the market — no cards.
              </span>{" "}
              Here is where the money goes:
            </Text>

            {/* SPEC §14: a table, not a card, "because the point is that the
                notebook and the plan are one surface". The `Table` primitive
                carries the semantics; the overrides strip its data-grid chrome
                (cell padding, its own type scale) down to the design's
                borderless doc rules. */}
            <Table className="text-xs">
              <THead>
                <TR className="border-border-strong">
                  <TH className="w-full px-0 pt-0 pb-1.25 font-mono text-3xs font-normal tracking-wider">Day 6</TH>
                  <TH className="px-0 pt-0 pb-1.25 pl-2.5 font-mono text-3xs font-normal tracking-wider">Who</TH>
                  <TH className="px-0 pt-0 pb-1.25 pl-2.5 text-right font-mono text-3xs font-normal tracking-wider">Cost</TH>
                </TR>
              </THead>
              <TBody>
                {COST_ROWS.map((row) => (
                  <TR key={row.item}>
                    <TD className="px-0 py-1.5 align-middle text-ink">{row.item}</TD>
                    <TD className="px-0 py-1.5 pl-2.5 align-middle text-2xs text-slate">{row.who}</TD>
                    <TD className="px-0 py-1.5 pl-2.5 text-right align-middle">
                      <DataText className="text-2xs text-ink">{row.cost}</DataText>
                    </TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR className="border-b-0 font-semibold">
                  <TD className="px-0 pt-1.5 align-middle text-ink">Day total</TD>
                  <TD className="px-0 pt-1.5" />
                  <TD className="px-0 pt-1.5 pl-2.5 text-right align-middle">
                    <DataText className="text-2xs font-semibold text-ink">{COST_TOTAL}</DataText>
                  </TD>
                </TR>
              </TFoot>
            </Table>

            <Text as="p" className="text-sm leading-relaxed text-pretty">
              Trains are on Sam, and we settle up in Osaka.
            </Text>
          </div>
        </div>
      </Card>
    </div>
  );
}
