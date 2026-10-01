import type { WeatherPayload, WeatherRow } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";

// The weather block as a table: the same rows the graphic draws, read as
// Day · City · High · Low · Rain · Source. Where the graphic tells a forecast
// from an average by line style, this says it in a word.
//
// One place for each column's width, so the heading row and the data rows
// cannot disagree about where a column is. The city is the column that gives:
// it flexes and truncates, and no row has a minimum width, so the table fits
// its column rather than scrolling inside it.
//
// **Under `@md` the day sits beneath its city** and the values drop to
// text-xs. Six columns side by side left the city nothing on a phone: the
// fixed ones alone came to 352px of a 320px column. Stacked, they are 238px
// with their gaps, padding and the frame's border, so the city keeps 82px at
// 320 and 137px at 375. The step is on the table's own width (a container query), as the
// graphic's is.
const COL = {
  // Day and City together: one stacked column when narrow, two when not.
  place: "flex min-w-0 flex-1 flex-col-reverse leading-tight @md:flex-row @md:items-center @md:gap-2",
  day: "shrink-0 @md:w-12",
  city: "min-w-0 truncate @md:flex-1",
  // "-12°C" and "100°F" are five mono characters: 36px at text-xs, 39px at text-sm.
  temp: "w-10 shrink-0 text-right @md:w-12",
  // "12.10 mm" is eight mono characters: 58px at text-xs, 67px at text-sm.
  rain: "w-15 shrink-0 text-right @md:w-20",
  source: "w-12 shrink-0 text-xs @md:w-16 @md:text-sm",
} as const;
const ROW = "flex w-full items-center gap-1.5 border-b border-hairline px-3 @md:gap-2";
const VALUE = "text-xs @md:text-sm";

const SOURCE = { forecast: "Forecast", typical: "Typical" } as const;

function Value({ text, label, width }: { text: string | null; label: string; width: string }) {
  return (
    <span role="cell" aria-label={label} className={width}>
      <DataText className={cn(VALUE, text !== null && "text-ink")}>{text ?? "—"}</DataText>
    </span>
  );
}

function Headings() {
  return (
    <span role="row" className={cn(ROW, "h-8 bg-paper text-xs font-medium text-slate")}>
      {/* Side by side at every width: a heading row has one line. */}
      <span role="presentation" className="flex min-w-0 flex-1 items-center gap-2">
        <span role="columnheader" className={COL.day}>Day</span>
        <span role="columnheader" className={COL.city}>City</span>
      </span>
      <span role="columnheader" className={COL.temp}>High</span>
      <span role="columnheader" className={COL.temp}>Low</span>
      <span role="columnheader" className={COL.rain}>Rain</span>
      <span role="columnheader" className={COL.source}>Source</span>
    </span>
  );
}

function Row({ row }: { row: WeatherRow }) {
  return (
    <span role="row" data-source={row.source ?? undefined} className={cn(ROW, "h-10 last:border-b-0")}>
      <span role="presentation" className={COL.place}>
        <span role="rowheader" className={COL.day}>
          <DataText size="xs">{row.label}</DataText>
        </span>
        <span role="cell" className={cn(COL.city, "text-sm font-semibold text-ink")}>
          {row.city ?? "—"}
        </span>
      </span>
      <Value text={row.high} label="high" width={COL.temp} />
      <Value text={row.low} label="low" width={COL.temp} />
      <Value text={row.rain} label="rain" width={COL.rain} />
      <span role="cell" aria-label="source" className={cn(COL.source, row.source ? "text-ink" : "text-slate")}>
        {row.source ? SOURCE[row.source] : "—"}
      </span>
    </span>
  );
}

/** The weather block as a table: a fixed-height row per (day, city), with its source in a word. */
export function WeatherTable({ payload }: { payload: WeatherPayload }) {
  return (
    <span role="table" aria-label={payload.summary} className="@container flex flex-col">
      {payload.headings ? <Headings /> : null}
      {payload.rows.map((row) => (
        <Row key={row.key} row={row} />
      ))}
    </span>
  );
}
