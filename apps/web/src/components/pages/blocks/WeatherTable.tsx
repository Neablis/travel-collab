import type { WeatherPayload, WeatherRow } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { PlaceCells, PlaceHeadings, TABLE_ROW, TABLE_VALUES } from "./tableCells";

// The weather block as a table: the same rows the graphic draws, read as
// Day · City · High · Low · Rain · Source. Where the graphic tells a forecast
// from an average by line style, this says it in a word.
//
// One place for each column's width, so the heading row and the data rows
// cannot disagree about where a column is. No row has a minimum width, so the
// table fits its column rather than scrolling inside it.
//
// **Under `@md` a row is two lines** (`tableCells.tsx`): the city and its day,
// then High · Low · Rain · Source spread across the row. Every row is 56px
// there, whatever its source (ADR-044), and 40px from `@md`.
//
// The second line's arithmetic, in a 273px block (a 375px viewport): 271px
// inside the frame's border, 247px inside the row's padding. The four columns
// are 40 + 40 + 60 + 56 = 196px and their three gaps at least 18px, so 214px
// fits with 33px to spread. In a 218px block (a 320px viewport) the line is
// 192px: the columns shrink together, by the same share in every row, to 36,
// 36, 53 and 50px. That still holds "18°C", "2.14 mm" and "Forecast"; only a
// five-character temperature or an eight-character rain then runs a few
// pixels into the gap beside it.
const COL = {
  // "-12°C" and "100°F" are five mono characters: 36px at text-xs, 39px at text-sm.
  temp: "w-10 min-w-0 whitespace-nowrap text-right @md:w-12 @md:shrink-0",
  // "12.10 mm" is eight mono characters: 58px at text-xs, 63px at text-sm.
  rain: "w-15 min-w-0 whitespace-nowrap text-right @md:w-20 @md:shrink-0",
  // "Forecast" is the longer word: about 47px at text-xs.
  source: "w-14 min-w-0 whitespace-nowrap text-right text-xs @md:w-16 @md:shrink-0 @md:text-left @md:text-sm",
} as const;
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
    <span role="row" className={cn(TABLE_ROW, "h-8 bg-paper text-xs font-medium text-slate")}>
      <PlaceHeadings />
      <span role="presentation" className={TABLE_VALUES}>
        <span role="columnheader" className={COL.temp}>High</span>
        <span role="columnheader" className={COL.temp}>Low</span>
        <span role="columnheader" className={COL.rain}>Rain</span>
        <span role="columnheader" className={COL.source}>Source</span>
      </span>
    </span>
  );
}

function Row({ row }: { row: WeatherRow }) {
  return (
    <span role="row" data-source={row.source ?? undefined} className={cn(TABLE_ROW, "h-14 last:border-b-0 @md:h-10")}>
      <PlaceCells label={row.label} city={row.city} />
      <span role="presentation" className={TABLE_VALUES}>
        <Value text={row.high} label="high" width={COL.temp} />
        <Value text={row.low} label="low" width={COL.temp} />
        <Value text={row.rain} label="rain" width={COL.rain} />
        <span role="cell" aria-label="source" className={cn(COL.source, row.source ? "text-ink" : "text-slate")}>
          {row.source ? SOURCE[row.source] : "—"}
        </span>
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
