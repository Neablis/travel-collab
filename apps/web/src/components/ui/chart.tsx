"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";

// shadcn/ui's `chart` (new-york-v4), vendored and re-themed (ADR-010), and THE
// one chart component (M14 link 11, Mitchell 2026-09-24: *"charts use shadcn/ui's
// chart component (Recharts)"*). A chart elsewhere goes through this file.
//
// What changed from upstream, and why each one had to:
//
// - **`color` is a token, not a CSS colour.** Upstream takes any string and
//   writes it into a `<style>` tag, which is how a chart brings a palette of
//   its own. Here the type admits only `@theme` properties, so a literal cannot
//   be written, and `chart.test.tsx` renders a chart and fails on any fill,
//   stroke or font that is not a token — Recharts' own grey gridline and tick
//   defaults included, which no source grep can see.
// - **`--chart-<key>`, not upstream's `--color-<key>`.** `--color-*` is the
//   token namespace; `--color-meal` would read as a token that does not exist,
//   and the colour wall rightly fails on one. Set as inline custom properties
//   rather than through `<style dangerouslySetInnerHTML>`.
// - **No arbitrary-selector classes** (`[&_.recharts-cartesian-grid_line…]`).
//   The lint wall bans arbitrary values, and styling Recharts' internals by
//   selector is how its defaults leaked through upstream in the first place.
//   The axis and grid props below are passed to Recharts directly instead.
// - **A fixed height, and a measured width without `ResponsiveContainer`.**
//   ADR-044: a widget never reflows, so the height is a prop, not an aspect
//   ratio. `ResponsiveContainer` constructs a `ResizeObserver` unguarded, which
//   jsdom does not have; measuring here feature-detects it.
// - **Mounted into a `<span>` through a portal, after hydration.** A widget is
//   an inline atom inside a paragraph (`MacroView.test.tsx`'s nesting sweep),
//   and Recharts emits a `<div>` wrapper, which the HTML parser would close the
//   paragraph at. The chart therefore never reaches server HTML: the span is
//   what the server renders — at the chart's full height, so nothing moves when
//   the chart arrives — and the SVG is appended into it on the client, where no
//   parser is involved.
// - **No tooltip or legend from Recharts.** Both render `<div>`s inside the
//   chart and neither prints. The legend here is spans beside the chart, and a
//   chart's numbers belong in its accessible table, not behind a hover.

// The `@theme` colour tokens a chart may use, spelled as the custom property
// rather than the bare name. The colour wall checks every `--color-*` it finds
// against `globals.css`, so each member here is verified to be a real token;
// the bare name `border-strong` would instead read to it as a `border-*`
// utility with no such colour.
/** A colour a chart may paint with: an `@theme` token's custom property. */
export type ChartToken =
  | "--color-ink" | "--color-slate" | "--color-hairline" | "--color-border-strong" | "--color-border-input"
  | "--color-surface" | "--color-brand" | "--color-warning" | "--color-info" | "--color-success";

/** Each series: its legend label and the token it paints with. */
export type ChartConfig = Record<string, { label: string; color: ChartToken }>;

/** A token as a value Recharts can put on an SVG attribute. */
export const tokenColor = (token: ChartToken) => `var(${token})`;
/** A configured series' colour, resolved by `ChartContainer`'s custom property. */
export const seriesColor = (key: string) => `var(--chart-${key})`;

// Every datum is IBM Plex Mono (design-system.md, "Data"). `fontSize` is the
// `text-xs` token's size: an SVG attribute cannot take a Tailwind class.
const MONO = "var(--font-mono)";
/** Axis tick text: slate, mono, `text-xs`. */
export const chartTick = { fill: tokenColor("--color-slate"), fontFamily: MONO, fontSize: 12 } as const;
/** A value printed on the chart itself: ink, mono, `text-xs`. */
export const chartLabel = { fill: tokenColor("--color-ink"), fontFamily: MONO, fontSize: 12 } as const;
/** Horizontal gridlines only, in hairline — the grid is a ruler, not content. */
export const chartGrid = { stroke: tokenColor("--color-hairline"), vertical: false } as const;
/** The category axis' baseline. */
export const chartAxisLine = { stroke: tokenColor("--color-hairline") } as const;

// The width a chart draws at before it is measured, and forever where nothing
// can measure (jsdom). A notebook column is wider; the first frame is a guess.
const INITIAL_WIDTH = 320;

// Upstream's `ChartContext`/`useChart` are not vendored: they exist to feed
// its tooltip and legend content, and neither is used here (see above).
function useWidth(host: HTMLElement | null): number {
  const [width, setWidth] = React.useState(INITIAL_WIDTH);
  React.useEffect(() => {
    if (!host || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const measured = host.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);
  return width;
}

/**
 * The frame every chart draws in: a fixed-height span carrying the series
 * colours as custom properties, and the one Recharts chart it is handed, sized
 * to it.
 *
 * `label` is what a screen reader hears for the picture (`role="img"`): a
 * chart's summary sentence. The numbers go in a table beside it.
 */
export function ChartContainer({
  config,
  height,
  label,
  className,
  children,
}: {
  config: ChartConfig;
  height: number;
  label: string;
  className?: string;
  children: React.ReactElement<{ width?: number; height?: number }>;
}) {
  const [host, setHost] = React.useState<HTMLSpanElement | null>(null);
  const width = useWidth(host);
  const vars = Object.fromEntries(
    Object.entries(config).map(([key, { color }]) => [`--chart-${key}`, tokenColor(color)]),
  ) as React.CSSProperties;

  return (
    <span
      ref={setHost}
      role="img"
      aria-label={label}
      data-slot="chart"
      className={cn("block w-full overflow-hidden font-mono text-xs text-slate", className)}
      style={{ height, ...vars }}
    >
      {host && createPortal(React.cloneElement(children, { width, height }), host)}
    </span>
  );
}

/**
 * The key: a swatch and a label per series, as spans so it can sit in a
 * paragraph. `extra` is for marks that are not series — a reference line.
 */
export function ChartLegend({ config, extra, className }: { config: ChartConfig; extra?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate", className)}>
      {Object.entries(config).map(([key, { label, color }]) => (
        <span key={key} className="flex items-center gap-1.5">
          {/* The token itself, not `--chart-<key>`: the legend sits outside
              the container that defines those properties. */}
          <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: tokenColor(color) }} />
          {label}
        </span>
      ))}
      {extra}
    </span>
  );
}
