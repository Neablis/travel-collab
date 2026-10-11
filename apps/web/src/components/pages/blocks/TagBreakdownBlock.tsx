import { Suspense, lazy } from "react";
import type { TagBreakdownPayload } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { ChartErrorBoundary, ChartPlaceholder, tokenColor, type ChartConfig } from "@/components/ui/chart";
import { SPEND_SERIES_COLOR } from "./spendColors";

// "Activities by tag" and "Hours by tag" (`tag.breakdown`, M42 D11): the
// picture, a donut or a bar per tag, and beside it the key as a real table,
// laid out as "Spend by tag"'s is and for its reasons — a dozen rows and a
// total are short enough to show, so the same rows serve a sighted reader, a
// screen reader and paper. Spans throughout: this sits inside a paragraph.
const TagBreakdownChart = lazy(() => import("./TagCharts").then((m) => ({ default: m.TagBreakdownChart })));

// ADR-044: fixed, so the page never moves when the picture arrives. `w-44` is
// the same 176px, so the donut is a circle.
const TAG_CHART_SIZE = 176;

/** Each tag's label and colour, shared by the picture and its key: the spend charts' colours. */
export function tagBreakdownConfig(payload: TagBreakdownPayload): ChartConfig {
  return Object.fromEntries(payload.slices.map(({ key, label }) => [key, { label, color: SPEND_SERIES_COLOR[key] }]));
}

export function TagBreakdownBlock({ payload }: { payload: TagBreakdownPayload }) {
  const config = tagBreakdownConfig(payload);
  return (
    <span className="flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3">
      <span aria-hidden className="block text-xs font-medium text-slate">
        {payload.title}
      </span>
      <span className="flex flex-wrap items-center gap-4">
        <span className="block w-44 shrink-0">
          <ChartErrorBoundary fallback={<ChartPlaceholder height={TAG_CHART_SIZE} label={payload.summary} busy={false} />}>
            <Suspense fallback={<ChartPlaceholder height={TAG_CHART_SIZE} label={payload.summary} />}>
              <TagBreakdownChart payload={payload} config={config} height={TAG_CHART_SIZE} />
            </Suspense>
          </ChartErrorBoundary>
        </span>
        <span role="table" aria-label={payload.title} className="table min-w-0 flex-1 border-collapse text-sm text-ink">
          <span role="row" className="sr-only">
            <span role="columnheader">Tag</span>
            <span role="columnheader">{payload.valueHeading}</span>
            <span role="columnheader">Share</span>
          </span>
          {/* Only the tags that carry something: twelve categories of rows,
              most of them empty, would bury the few a trip has. */}
          {payload.slices.filter((slice) => slice.value > 0).map((slice) => (
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
                <DataText className="text-ink">{slice.text}</DataText>
              </span>
              <span role="cell" className="table-cell py-1 text-right align-middle">
                <DataText size="xs">{slice.share}</DataText>
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
