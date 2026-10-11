import { Suspense, lazy } from "react";
import type { TagsByDayPayload } from "@tc/pages";
import { ChartErrorBoundary, ChartLegend, ChartPlaceholder, type ChartConfig } from "@/components/ui/chart";
import { SPEND_SERIES_COLOR } from "./spendColors";

// "Tags by day" (`tag.byDay`, M42 D11): a bar per day stacked by tag, its key,
// what it left out, and every count as a table for a screen reader — "Spend by
// day"'s layout, counting stops where that one sums money.
const TagsByDayChart = lazy(() => import("./TagCharts").then((m) => ({ default: m.TagsByDayChart })));

// ADR-044: fixed, so the page never moves when the chart arrives.
const TAGS_BY_DAY_HEIGHT = 224;

export function tagsByDayConfig(payload: TagsByDayPayload): ChartConfig {
  return Object.fromEntries(payload.series.map(({ key, label }) => [key, { label, color: SPEND_SERIES_COLOR[key] }]));
}

export function TagsByDayBlock({ payload }: { payload: TagsByDayPayload }) {
  const config = tagsByDayConfig(payload);
  return (
    <span className="flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3">
      <ChartErrorBoundary fallback={<ChartPlaceholder height={TAGS_BY_DAY_HEIGHT} label={payload.summary} busy={false} />}>
        <Suspense fallback={<ChartPlaceholder height={TAGS_BY_DAY_HEIGHT} label={payload.summary} />}>
          <TagsByDayChart payload={payload} config={config} height={TAGS_BY_DAY_HEIGHT} />
        </Suspense>
      </ChartErrorBoundary>
      <ChartLegend config={config} />
      {payload.notCharted ? <span className="block text-xs text-slate">{payload.notCharted}</span> : null}
      <span role="table" aria-label="Tags by day" className="sr-only print:not-sr-only print:table print:w-full print:text-xs">
        <span role="row" className="print:table-row">
          <span role="columnheader" className="print:table-cell print:pr-3">Day</span>
          <span role="columnheader" className="print:table-cell print:pr-3">Date</span>
          <span role="columnheader" className="print:table-cell print:pr-3">Stops</span>
          <span role="columnheader" className="print:table-cell print:pr-3">By tag</span>
        </span>
        {payload.days.map((day) => (
          <span role="row" key={day.label} className="print:table-row">
            <span role="rowheader" className="print:table-cell print:pr-3">{day.label}</span>
            <span role="cell" className="print:table-cell print:pr-3">{day.date ?? "—"}</span>
            <span role="cell" className="print:table-cell print:pr-3">{day.total}</span>
            <span role="cell" className="print:table-cell print:pr-3">{day.breakdown ?? "—"}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
