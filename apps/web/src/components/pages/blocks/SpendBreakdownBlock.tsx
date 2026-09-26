import { Suspense, lazy } from "react";
import type { ActivityKind } from "@tc/contracts";
import type { SpendBreakdownPayload } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { ChartErrorBoundary, ChartPlaceholder, tokenColor, type ChartConfig, type ChartToken } from "@/components/ui/chart";
import { SPEND_SERIES_COLOR } from "./spendColors";

// "Spend by kind" and "Spend by tag" (`cost.breakdown`) — a donut of what the
// selection cost per kind or per tag, and beside it the key as a real table:
// each slice's swatch, amount and share, and the total. Mitchell, 2026-09-26,
// moving the Settings sheet's M19 breakdown shell here as a notebook widget,
// then asking for the same pie by tag.
//
// **The key is the text alternative, and it is on screen.** Unlike "Spend by
// day", whose table is screen-reader-only because a day per row would be longer
// than the chart, five slices and a total are short enough to show — so the
// same rows serve a sighted reader, a screen reader and paper. The picture is
// `role="img"` named by the summary sentence, and the table by the title, which
// says what the widget is narrowed to ("Spend by tag · Pending").
//
// Spans throughout, for `CostsTableBlock`'s reason: this sits inside a
// paragraph. The picture is lazy, for `SpendByDayBlock`'s.
const SpendBreakdownChart = lazy(() => import("./SpendBreakdownChart").then((m) => ({ default: m.SpendBreakdownChart })));

// The board's kind colours (`board/activityKind.ts`'s badge variants), as
// solids, so Pending is amber and Travel blue on the card and in the chart.
// Planned has no badge on the board — it is the zero value — so it takes the
// brand: in a pie it is the bulk of the money, not a remainder, and the quiet
// neutral `untagged` wears in the bars would make the biggest slice read as
// the least important.
const KIND_COLOR: Record<ActivityKind, ChartToken> = {
  planned: "--color-brand",
  pending: "--color-warning",
  transit: "--color-info",
};

// ADR-044: fixed, so the page never moves when the picture arrives. The
// picture's column is `w-44`, the same 176px, so the donut is a circle.
const BREAKDOWN_CHART_SIZE = 176;

/**
 * Each slice's label and colour, shared by the picture and its key: a kind's
 * from `KIND_COLOR`, a tag's from `SPEND_SERIES_COLOR` — the map "Spend by
 * day" stacks with, so a meal is one colour in both charts.
 */
export function breakdownChartConfig(payload: SpendBreakdownPayload): ChartConfig {
  return payload.by === "kind"
    ? Object.fromEntries(payload.slices.map(({ key, label }) => [key, { label, color: KIND_COLOR[key] }]))
    : Object.fromEntries(payload.slices.map(({ key, label }) => [key, { label, color: SPEND_SERIES_COLOR[key] }]));
}

/** "Spend by kind" / "Spend by tag": the donut, its key with every amount and share, and what it left out. */
export function SpendBreakdownBlock({ payload }: { payload: SpendBreakdownPayload }) {
  const config = breakdownChartConfig(payload);
  return (
    <span className="flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3">
      {/* What it is and what it is narrowed to. Hidden from a screen reader,
          which hears the same words as the table's name. */}
      <span aria-hidden className="block text-xs font-medium text-slate">
        {payload.title}
      </span>
      <span className="flex flex-wrap items-center gap-4">
        {/* `w-44` is 176px, `BREAKDOWN_CHART_SIZE`: the column is as wide as the donut is tall. */}
        <span className="block w-44 shrink-0">
          <ChartErrorBoundary fallback={<ChartPlaceholder height={BREAKDOWN_CHART_SIZE} label={payload.summary} busy={false} />}>
            <Suspense fallback={<ChartPlaceholder height={BREAKDOWN_CHART_SIZE} label={payload.summary} />}>
              <SpendBreakdownChart payload={payload} config={config} height={BREAKDOWN_CHART_SIZE} />
            </Suspense>
          </ChartErrorBoundary>
        </span>
        <span role="table" aria-label={payload.title} className="table min-w-0 flex-1 border-collapse text-sm text-ink">
          <span role="row" className="sr-only">
            <span role="columnheader">{payload.keyHeading}</span>
            <span role="columnheader">Amount</span>
            <span role="columnheader">Share</span>
          </span>
          {payload.slices.map((slice) => (
            <span role="row" key={slice.key} className="table-row">
              <span role="rowheader" className="table-cell py-1 pr-3 align-middle">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    // eslint-disable-next-line no-restricted-syntax -- the swatch paints the slice's own `ChartToken`, as `ChartLegend` does, so key and picture cannot disagree
                    style={{ backgroundColor: tokenColor(config[slice.key]!.color) }}
                  />
                  {slice.label}
                </span>
              </span>
              <span role="cell" className="table-cell py-1 pr-3 text-right align-middle">
                {slice.amount ? <DataText className="text-ink">{slice.amount}</DataText> : <span className="text-xs text-slate">nothing priced</span>}
              </span>
              <span role="cell" className="table-cell py-1 text-right align-middle">
                <DataText size="xs">{slice.share ?? "—"}</DataText>
              </span>
            </span>
          ))}
          <span role="row" className="table-row font-medium">
            <span role="rowheader" className="table-cell border-t border-hairline pt-1.5 pr-3">Total</span>
            <span role="cell" className="table-cell border-t border-hairline pt-1.5 pr-3 text-right">
              <DataText className="text-ink">{payload.total}</DataText>
            </span>
            <span role="cell" className="table-cell border-t border-hairline pt-1.5" />
          </span>
        </span>
      </span>
      {payload.notCharted ? <span className="block text-xs text-slate">{payload.notCharted}</span> : null}
    </span>
  );
}
