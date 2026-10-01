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
const COL = {
  day: "w-12 shrink-0",
  city: "min-w-0 flex-1 truncate",
  // 48px: "-12°C" and "100°F" are five mono characters, 39px at text-sm.
  temp: "w-12 shrink-0 text-right",
  // 80px: "12.10 mm" is eight mono characters, 67px at text-sm.
  rain: "w-20 shrink-0 text-right",
  source: "w-16 shrink-0",
} as const;
const ROW = "flex w-full items-center gap-2 border-b border-hairline px-3";

const SOURCE = { forecast: "Forecast", typical: "Typical" } as const;

function Value({ text, label, width }: { text: string | null; label: string; width: string }) {
  return (
    <span role="cell" aria-label={label} className={width}>
      <DataText className={text === null ? undefined : "text-ink"}>{text ?? "—"}</DataText>
    </span>
  );
}

function Headings() {
  return (
    <span role="row" className={cn(ROW, "h-8 bg-paper text-xs font-medium text-slate")}>
      <span role="columnheader" className={COL.day}>Day</span>
      <span role="columnheader" className={COL.city}>City</span>
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
      <span role="rowheader" className={COL.day}>
        <DataText size="xs">{row.label}</DataText>
      </span>
      <span role="cell" className={cn(COL.city, "text-sm font-semibold text-ink")}>
        {row.city ?? "—"}
      </span>
      <Value text={row.high} label="high" width={COL.temp} />
      <Value text={row.low} label="low" width={COL.temp} />
      <Value text={row.rain} label="rain" width={COL.rain} />
      <span role="cell" aria-label="source" className={cn(COL.source, "text-sm", row.source ? "text-ink" : "text-slate")}>
        {row.source ? SOURCE[row.source] : "—"}
      </span>
    </span>
  );
}

/** The weather block as a table: a fixed-height row per (day, city), with its source in a word. */
export function WeatherTable({ payload }: { payload: WeatherPayload }) {
  return (
    <span role="table" aria-label={payload.summary} className="flex flex-col">
      {payload.headings ? <Headings /> : null}
      {payload.rows.map((row) => (
        <Row key={row.key} row={row} />
      ))}
    </span>
  );
}
