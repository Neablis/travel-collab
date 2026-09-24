import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderMacro } from "@tc/pages";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { spendChartConfig } from "../pages/blocks/SpendByDayBlock";
import { SpendByDayChart } from "../pages/blocks/SpendByDayChart";

// The M14 gate box, as a test: *"Charts go through the one adopted chart
// component, and none carries a colour or font outside the design-system
// tokens."*
//
// Two halves, because each misses what the other catches:
//
// - **The source**: every file that imports Recharts also draws through
//   `ChartContainer`, and writes no colour or font as a literal. The colour
//   wall (`scripts/check-color-wall.mjs`) already refuses hex/rgb/hsl in
//   `apps/web/src`; it does not know `oklch()`, a named colour or a font stack.
// - **The render**: Recharts has defaults — grey gridlines and tick text, a
//   blue bar, a font stack on its labels — that no source grep can see,
//   because they are in `node_modules` and appear only once a chart draws. So
//   every chart is rendered and every paint and font on its DOM is checked.

const SRC = join(__dirname, "../..");
const globalsCss = readFileSync(join(SRC, "app/globals.css"), "utf8");
const TOKENS = new Set([...globalsCss.matchAll(/^\s*--color-([a-z0-9-]+)\s*:/gm)].map((m) => m[1]!));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const importsRecharts = (source: string) => /from\s+["']recharts["']/.test(source);
const CHART_COMPONENT = "components/ui/chart.tsx";

// One fixture per chart, keyed by file. The static half below fails when a file
// starts importing Recharts without an entry here, so a new chart cannot skip
// the render sweep by not being listed.
function spendTrip(): TripDetail {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: 3, activitiesPerDay: 3 } });
  trip.budget = { amountMinor: 60000, currency: "USD" };
  const tags = [["meal"], ["lodging"], ["ticketed"], ["outdoors"], [], ["meal"]] as const;
  trip.days.flatMap((day) => day.activityIds).slice(0, tags.length).forEach((id, i) => {
    trip.activities[id] = { ...trip.activities[id]!, cost: { amountMinor: 2500 * (i + 1), currency: "USD" }, tags: [...tags[i]!] };
  });
  return trip;
}

const CHARTS: Record<string, () => ReactElement> = {
  // The chart itself, not `SpendByDayBlock`, which loads it lazily: rendering
  // the block would sweep a placeholder.
  "components/pages/blocks/SpendByDayChart.tsx": () => {
    const trip = spendTrip();
    const outcome = renderMacro({ trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null }, "cost.chart", {});
    if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "spend-by-day") {
      throw new Error(`expected a spend-by-day block, got ${outcome.status}`);
    }
    const payload = outcome.rendered.block;
    return <SpendByDayChart payload={payload} config={spendChartConfig(payload)} height={224} />;
  },
};

// A paint is a token, a series property that `ChartContainer` sets FROM a
// token, or one of the four keywords that are not a colour at all.
const PAINT_OK = /^(?:var\(--(?:color|chart)-[a-z0-9-]+\)|none|transparent|currentColor|inherit)$/;
const FONT_OK = /^var\(--font-mono\)$/;
const PAINT_ATTRS = ["fill", "stroke", "color", "stop-color", "flood-color", "lighting-color"];
const PAINT_STYLES = ["color", "background-color", "fill", "stroke", "border-color", "outline-color"];

/**
 * Every paint and font under `root` that is not a token, and how many
 * elements carried a paint at all — the witness that the sweep saw a drawn
 * chart rather than an empty frame.
 */
function sweep(root: HTMLElement): { offences: string[]; painted: number } {
  const found: string[] = [];
  let painted = 0;
  for (const el of [root, ...root.querySelectorAll<HTMLElement | SVGElement>("*")]) {
    const where = `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`;
    if (PAINT_ATTRS.some((attr) => el.hasAttribute(attr))) painted += 1;
    for (const attr of PAINT_ATTRS) {
      const value = el.getAttribute(attr);
      if (value !== null && !PAINT_OK.test(value)) found.push(`${where} ${attr}="${value}"`);
    }
    const font = el.getAttribute("font-family");
    if (font !== null && !FONT_OK.test(font)) found.push(`${where} font-family="${font}"`);
    for (const prop of PAINT_STYLES) {
      const value = el.style.getPropertyValue(prop);
      if (value && !PAINT_OK.test(value)) found.push(`${where} style ${prop}: ${value}`);
    }
    const styleFont = el.style.getPropertyValue("font-family");
    if (styleFont && !FONT_OK.test(styleFont)) found.push(`${where} style font-family: ${styleFont}`);
    // The series properties themselves must each be a token.
    for (const prop of Array.from(el.style)) {
      if (!prop.startsWith("--chart-")) continue;
      const value = el.style.getPropertyValue(prop).trim();
      const token = /^var\(--color-([a-z0-9-]+)\)$/.exec(value)?.[1];
      if (!token || !TOKENS.has(token)) found.push(`${where} ${prop}: ${value}`);
    }
    for (const value of [el.getAttribute("fill"), el.getAttribute("stroke")]) {
      const token = value && /^var\(--color-([a-z0-9-]+)\)$/.exec(value)?.[1];
      if (token && !TOKENS.has(token)) found.push(`${where} --color-${token} is not a token`);
    }
  }
  return { offences: found, painted };
}

describe("charts go through the one chart component, in tokens only", () => {
  const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), source: readFileSync(path, "utf8") }));
  const chartFiles = files.filter(({ path, source }) => path === CHART_COMPONENT || importsRecharts(source));

  it("finds the chart component and at least one chart", () => {
    expect(TOKENS.size, "parsed no tokens out of globals.css").toBeGreaterThan(10);
    expect(chartFiles.map((f) => f.path)).toContain(CHART_COMPONENT);
    expect(chartFiles.length).toBeGreaterThan(1);
  });

  it("draws every Recharts chart through ChartContainer, and renders each one below", () => {
    const charts = chartFiles.filter((f) => f.path !== CHART_COMPONENT);
    for (const { path, source } of charts) {
      expect(source, `${path} imports Recharts without ChartContainer`).toMatch(/\bChartContainer\b/);
    }
    expect(charts.map((f) => f.path).sort()).toEqual(Object.keys(CHARTS).sort());
  });

  it("writes no colour or font as a literal in any chart file", () => {
    const literal = [
      /#[0-9a-fA-F]{3,8}\b/,
      /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/,
      // A named colour where a paint goes: `fill="red"`, `stroke: "black"`.
      /\b(?:fill|stroke|color|stopColor|backgroundColor)\s*[=:]\s*["'](?!var\(|none|transparent|currentColor)[a-zA-Z]+["']/,
      // A font stack anywhere, rather than the mono token.
      /\bfont(?:Family|-family)\s*[=:]\s*["'](?!var\(--font-)/,
    ];
    let checked = 0;
    for (const { path, source } of chartFiles) {
      // Comments are where this repo explains what a literal was; the rule is
      // about code.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const pattern of literal) {
        expect(code, `${path} carries a literal matching ${pattern}`).not.toMatch(pattern);
        checked += 1;
      }
    }
    expect(checked).toBe(chartFiles.length * literal.length);
  });

  for (const [path, chart] of Object.entries(CHARTS)) {
    it(`${path}: every paint and font it renders is a token`, () => {
      render(chart());
      const { offences, painted } = sweep(screen.getByRole("img"));
      expect(offences).toEqual([]);
      // Measured at 27 painted elements for the spend fixture (bars, grid,
      // axis, ticks, labels, budget line). Half of that, so a Recharts upgrade
      // that draws a few marks differently does not flap, while a chart that
      // never drew — an empty span passes the check above — fails here.
      expect(painted, "the sweep saw no drawn chart").toBeGreaterThanOrEqual(13);
    });
  }
});
