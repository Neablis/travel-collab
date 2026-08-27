"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";

// The landing hero's rotating art — three views of the same Japan trip,
// transcribed from the design source
// `.design-sync/handoff/design/Trip Planner Redesign.dc.html:1885-1999`.
// Every value here is a marketing fixture that lives in this file: SPEC §14
// gives the front door no session, no fetch and no backend, so a data-model
// change must never be able to break it.

const ROTATE_MS = 10_000;
const VIEW_COUNT = 3;

// Pill order is display order; the view each one selects is deliberately not
// positional (`…dc.html:4297-4299`) — the trip's Day 6 map is the opening view.
const HERO_DAYS = [
  { label: "Day 5", view: 2 },
  { label: "Day 6", view: 0 },
  { label: "Day 7", view: 1 },
] as const;

// The design's own crew (`dc.html:2344`): Sam K, Priya R, Jonah M, Mei T. The
// page this replaced shipped PS/SK/MJ/AL, which matched nothing — and PR
// specifically has to be here, because Priya is named in this component's own
// art (the map presence pill, the notebook comment) and again in
// LandingFeatureBlocks. An avatar row without her contradicts the illustration
// it sits on. Keep these two files' crews identical.
const CREW = ["SK", "PR", "JM", "MT"] as const;

// Art coordinates: percentages of the hero box, because the pins sit on a
// drawn route rather than a layout grid. No Tailwind scale step expresses
// them, so they take design-system.md's computed-geometry escape hatch —
// collected here so the map view spends one disable on all three pins instead
// of one each.
const MAP_PINS = [
  { num: "1", title: "Fushimi Inari", time: "9:40", confirmed: true, at: { left: "14%", top: "22%" } },
  { num: "2", title: "Nishiki Market", time: "1:15", confirmed: true, at: { left: "34%", top: "55%" } },
  { num: "3", title: "Ryokan · unconfirmed", time: null, confirmed: false, at: { left: "70%", top: "78%" } },
] as const;

const MAP_COMMENT_AT = { left: "26%", right: "2%", top: "30%" };
const MAP_PRESENCE_AT = { left: "46%", top: "62%" };
// The Timeline and Notebook views hang their footer pill off the same 4% inset.
const FOOT_PILL_AT = { left: "4%" };
// `…dc.html:1949`: a 62px time column, off the 4px grid (62 / 4 = 15.5) and
// with no fractional-rem equivalent — same escape hatch as LandingScreen's
// STOP_GRID.
const TIMELINE_GRID = { gridTemplateColumns: "62px 1fr" };

const MAP_COMMENT = {
  quote: "“Market before the shrine and we're walking back on ourselves.”",
  meta: "Dana · on stop 2 · 2 replies",
};

const TIMELINE_ROWS = [
  { time: "8:20 am", title: "Shinkansen to Osaka", badge: { label: "Booked", variant: "success" } },
  { time: "11:00 am", title: "Osaka Castle", chip: "Marcus is dragging this", highlighted: true },
  {
    time: "1:30 pm",
    title: "Kuromon Market, lunch",
    badge: { label: "2 replies", variant: "neutral" },
    // ¥10,000 stays prose, not `DataText`, and that is the design's own
    // distinction rather than an oversight: `dc.html:1992` wraps ¥1,340 in a
    // mono macro chip because it is a value pulled from the plan, while
    // `:1967` leaves this one plain because it is a number inside someone's
    // quoted speech. The mono signature marks plan data, not any digit.
    note: "Sam: “Cash only — I'll pull ¥10,000 at the station.”",
  },
  { time: "7:00 pm", title: "Dinner — nobody has claimed this", muted: true, last: true },
] as const;

// Split around the inline macro chips it interleaves with, so the design's
// straight apostrophes survive verbatim (JSX text would need them escaped).
const NOTEBOOK_PROSE = {
  lead: "We leave Kyoto station at ",
  afterDeparture: " — early, but the onsen is the whole point. Two trains, one change at Demachiyanagi, ",
  afterFare: " each. ",
  warning: "Bring a towel — they don't rent them.",
  beforeReturn: " Home by ",
  tail: ", which leaves the evening open.",
};

const NOTEBOOK_COMMENT = {
  quote: "“I added the towel bit — learned that the hard way in Hakone.”",
  meta: "Priya · on this page · just now",
};

const MACRO_CHIP = "rounded-sm bg-brand-tint px-1.5 py-px text-brand-pressed";
const PANEL = "absolute inset-x-0 top-14.5 overflow-hidden rounded-xl border border-hairline bg-surface shadow-lifted";
const PANEL_HEAD = "flex items-center gap-2.5 border-b border-hairline px-3.5 py-3";
const FOOT_LABEL = "absolute bottom-0 rounded-full bg-paper/80 px-2.5 py-1";
const PRESENCE_PILL = "flex items-center gap-2 rounded-full border border-hairline bg-surface py-1 pr-3 pl-1.5 shadow-float";

// Not in the design: it auto-advances unconditionally. An animation a reader
// cannot pause is the accessibility hole that guard exists for, so the
// rotation stands still for `prefers-reduced-motion` — the day pills keep
// working, which is the only control the design gives. Feature-detected
// because jsdom does not always ship `matchMedia`.
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function LandingHeroArt(): React.ReactElement {
  const [view, setView] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mirrors the design's `heroStart()`: clear, then start. A day-pill click
  // calls it again so the reader gets a full 10s on the view they chose
  // (SPEC §14 — the design file's "stops the rotation for good" comment
  // contradicts its own `d.pick` handler and is stale).
  const startRotation = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    if (prefersReducedMotion()) return;
    timer.current = setInterval(() => setView((i) => (i + 1) % VIEW_COUNT), ROTATE_MS);
  }, []);

  useEffect(() => {
    startRotation();
    return () => {
      if (timer.current !== null) clearInterval(timer.current);
    };
  }, [startRotation]);

  const pick = (next: number) => {
    setView(next);
    startRotation();
  };

  return (
    <div className="relative h-107.5">
      {/* Above the art, or the decorative layers below swallow the clicks
          meant for these pills (DRIFT §2 names this trap by name). */}
      <div className="absolute top-0 left-0 z-10 flex items-center gap-2">
        <div className="flex gap-1 rounded-full border border-hairline bg-surface p-1 shadow-float">
          {HERO_DAYS.map((day) => (
            <Button
              key={day.label}
              variant="ghost"
              size="sm"
              aria-pressed={view === day.view}
              onClick={() => pick(day.view)}
              className={cn(
                "h-auto rounded-full px-2.5 py-1 font-mono text-2xs whitespace-nowrap transition-colors duration-200",
                view === day.view ? "bg-brand text-surface hover:bg-brand hover:text-surface" : "text-slate",
              )}
            >
              {day.label}
            </Button>
          ))}
        </div>
        {/* Initials with no name attached read as noise to a screen reader. */}
        <div aria-hidden className="pointer-events-none flex pl-1">
          {CREW.map((initials) => (
            <span
              key={initials}
              className="-ml-1.5 grid size-6.5 place-items-center rounded-full border-2 border-paper bg-brand-tint text-3xs font-semibold text-brand-pressed"
            >
              {initials}
            </span>
          ))}
        </div>
      </div>

      {view === 0 ? <MapView /> : null}
      {view === 1 ? <TimelineView /> : null}
      {view === 2 ? <NotebookView /> : null}
    </div>
  );
}

function MapView(): React.ReactElement {
  return (
    <>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full"
      >
        <path
          d="M14 22 C 26 34, 22 48, 34 55 S 62 60, 70 78"
          fill="none"
          className="stroke-brand"
          strokeWidth="1.4"
          strokeDasharray="4 3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {MAP_PINS.map((pin) => (
        <div
          key={pin.num}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2"
          // eslint-disable-next-line no-restricted-syntax -- absolute art coordinates, see MAP_PINS above
          style={pin.at}
        >
          <span
            className={cn(
              "grid size-7 flex-none place-items-center rounded-full font-mono font-semibold",
              pin.confirmed
                ? "bg-brand text-xs text-surface shadow-float"
                : "border-2 border-dashed border-brand bg-surface text-2xs text-brand-pressed",
            )}
          >
            {pin.num}
          </span>
          <span
            className={cn(
              "rounded-md border bg-surface px-2 py-1 text-xs whitespace-nowrap",
              pin.confirmed
                ? "border-hairline font-semibold text-ink shadow-float"
                : "border-dashed border-border-strong text-slate",
            )}
          >
            {pin.title}
            {pin.time ? (
              <DataText size="xs" className="ml-1 font-normal">
                {pin.time}
              </DataText>
            ) : null}
          </span>
        </div>
      ))}

      <div
        className="absolute flex items-start gap-2.5 rounded-lg rounded-bl-sm border border-hairline bg-surface px-3 py-2.5 shadow-lifted"
        // eslint-disable-next-line no-restricted-syntax -- absolute art coordinates, see MAP_PINS above
        style={MAP_COMMENT_AT}
      >
        <span
          aria-hidden
          className="grid size-5.5 flex-none place-items-center rounded-full bg-warning-tint text-3xs font-semibold text-warning-ink"
        >
          DK
        </span>
        <div className="flex flex-col gap-1">
          <Text as="span" className="text-xs text-pretty">
            {MAP_COMMENT.quote}
          </Text>
          <DataText className="text-3xs tracking-wider uppercase">{MAP_COMMENT.meta}</DataText>
        </div>
      </div>

      <div
        className={cn("absolute", PRESENCE_PILL)}
        // eslint-disable-next-line no-restricted-syntax -- absolute art coordinates, see MAP_PINS above
        style={MAP_PRESENCE_AT}
      >
        <span
          aria-hidden
          className="grid size-5 place-items-center rounded-full bg-brand-tint text-3xs font-semibold text-brand-pressed"
        >
          PR
        </span>
        <Text as="span" variant="secondary" className="text-2xs">
          Priya is moving stop 3
        </Text>
      </div>

      <DataText className={cn(FOOT_LABEL, "left-0 text-2xs")}>
        Day 6 · 3 stops · 4.2 km on foot · 5 hr gap
      </DataText>
    </>
  );
}

function TimelineView(): React.ReactElement {
  return (
    <>
      <div className={PANEL}>
        <div className={PANEL_HEAD}>
          <Text as="span" className="font-display font-semibold">
            Day 7 · Kyoto → Osaka
          </Text>
          <DataText className="ml-auto text-2xs tracking-wider uppercase">Timeline</DataText>
        </div>
        <div className="px-3.5 pt-1.5 pb-3">
          {TIMELINE_ROWS.map((row) => (
            <div
              key={row.time}
              className={cn(
                "grid gap-3 py-2.5",
                "last" in row ? null : "border-b border-hairline",
                "highlighted" in row ? "-mx-1.5 my-1 rounded-md bg-brand-tint px-1.5" : null,
              )}
              // eslint-disable-next-line no-restricted-syntax -- 62px time column, see TIMELINE_GRID above
              style={TIMELINE_GRID}
            >
              <DataText size="xs" className={cn("text-2xs", "highlighted" in row ? "text-brand-pressed" : null)}>
                {row.time}
              </DataText>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Text as="span" className={cn("text-sm", "muted" in row ? "text-slate" : "font-semibold")}>
                    {row.title}
                  </Text>
                  {"badge" in row ? <Badge variant={row.badge.variant}>{row.badge.label}</Badge> : null}
                  {"chip" in row ? (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-3xs font-semibold tracking-wider text-surface uppercase">
                      {row.chip}
                    </span>
                  ) : null}
                </div>
                {"note" in row ? (
                  <Text as="span" variant="muted">
                    {row.note}
                  </Text>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className={cn("absolute bottom-0", PRESENCE_PILL)}
        // eslint-disable-next-line no-restricted-syntax -- absolute art coordinates, see MAP_PINS above
        style={FOOT_PILL_AT}
      >
        <span
          aria-hidden
          className="grid size-5 place-items-center rounded-full bg-warning-tint text-3xs font-semibold text-warning-ink"
        >
          DK
        </span>
        <Text as="span" variant="secondary" className="text-2xs">
          Dana is reading Day 7
        </Text>
      </div>
    </>
  );
}

function NotebookView(): React.ReactElement {
  return (
    <>
      <div className={PANEL}>
        <div className={PANEL_HEAD}>
          <Text as="span" className="font-display font-semibold">
            Getting to Kurama — Day 5
          </Text>
          <DataText className="ml-auto text-2xs tracking-wider uppercase">Notebook</DataText>
        </div>

        <Text as="p" className="px-3.5 py-3.5 text-sm leading-relaxed text-pretty">
          {NOTEBOOK_PROSE.lead}
          <DataText size="xs" className={MACRO_CHIP}>
            7:45 am
          </DataText>
          {NOTEBOOK_PROSE.afterDeparture}
          <DataText size="xs" className={MACRO_CHIP}>
            ¥1,340
          </DataText>
          {NOTEBOOK_PROSE.afterFare}
          <span className="border-b-2 border-warning bg-warning-tint px-0.5">{NOTEBOOK_PROSE.warning}</span>
          {NOTEBOOK_PROSE.beforeReturn}
          <DataText size="xs" className={MACRO_CHIP}>
            4:10 pm
          </DataText>
          {NOTEBOOK_PROSE.tail}
        </Text>

        <div className="mx-3.5 mb-3.5 flex items-start gap-2.5 rounded-lg bg-moss px-3 py-2.5">
          <span
            aria-hidden
            className="grid size-5.5 flex-none place-items-center rounded-full bg-brand-tint text-3xs font-semibold text-brand-pressed"
          >
            PR
          </span>
          <div className="flex flex-col gap-1">
            <Text as="span" className="text-xs text-pretty">
              {NOTEBOOK_COMMENT.quote}
            </Text>
            <DataText className="text-3xs tracking-wider uppercase">{NOTEBOOK_COMMENT.meta}</DataText>
          </div>
        </div>
      </div>

      <DataText
        className={cn(FOOT_LABEL, "text-2xs")}
        // eslint-disable-next-line no-restricted-syntax -- absolute art coordinates, see MAP_PINS above
        style={FOOT_PILL_AT}
      >
        Times come from the plan — move the day and they follow
      </DataText>
    </>
  );
}
