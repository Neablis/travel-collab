import type { SunPayload, SunRow } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { PlaceCells, PlaceHeadings, TABLE_ROW, TABLE_VALUES } from "./tableCells";

// The sun block as a table: the same rows the graphic draws, read as
// Day · City · Sunrise · Sunset · Daylight. The golden hour has no column: it
// is drawn on the graphic and not written anywhere.
//
// One place for each column's width, so the heading row and the data rows
// cannot disagree about where a column is. No row has a minimum width, so the
// table fits its column rather than scrolling inside it.
//
// **Under `@md` a row is two lines** (`tableCells.tsx`), as the weather
// table's is: the city and its day, then Sunrise · Sunset · Daylight. On that
// line the daylight keeps 56px and the two times share the rest. In a 273px
// block (a 375px viewport) the line is 247px inside the border and padding, so
// each time has 89px; in a 218px block (a 320px viewport) it is 192px, and
// each has 62px — room for "5:42 am", with "(next day)" wrapping beneath it.
//
// A row has a minimum height, not a fixed one, as the graphic's has: a time
// with "(next day)" after it, or a polar day's words, wraps inside its column.
const COL = {
  // "(next day)" is ten mono characters: 72px at text-xs, 78px at text-sm.
  time: "min-w-0 flex-1 @md:w-24 @md:flex-none",
  // "14h 35m" is seven mono characters: 51px at text-xs, 55px at text-sm.
  daylight: "w-14 shrink-0 text-right @md:w-16",
} as const;
const VALUE = "text-xs leading-tight @md:text-sm";

function Value({ text, label, width }: { text: string; label: string; width: string }) {
  return (
    <span role="cell" aria-label={label} className={width}>
      <DataText className={cn(VALUE, text !== "—" && "text-ink")}>{text}</DataText>
    </span>
  );
}

function Headings() {
  return (
    <span role="row" className={cn(TABLE_ROW, "h-8 bg-paper text-xs font-medium text-slate")}>
      <PlaceHeadings />
      <span role="presentation" className={TABLE_VALUES}>
        <span role="columnheader" className={COL.time}>Sunrise</span>
        <span role="columnheader" className={COL.time}>Sunset</span>
        <span role="columnheader" className={COL.daylight}>Daylight</span>
      </span>
    </span>
  );
}

function Row({ row }: { row: SunRow }) {
  return (
    <span role="row" data-state={row.state} className={cn(TABLE_ROW, "min-h-14 py-1 last:border-b-0 @md:min-h-10")}>
      <PlaceCells label={row.label} city={row.city} />
      <span role="presentation" className={TABLE_VALUES}>
        {/* A polar day's words take the sunrise column, and leave the sunset
            column a dash: a column that moves per row is not a column. */}
        <Value text={row.words ?? row.sunrise ?? "—"} label="sunrise" width={COL.time} />
        <Value text={row.sunset ?? "—"} label="sunset" width={COL.time} />
        <Value text={row.daylight} label="daylight" width={COL.daylight} />
      </span>
    </span>
  );
}

/** The sun block as a table: a row per day, its sunrise, sunset and length of daylight. */
export function SunTable({ payload }: { payload: SunPayload }) {
  return (
    <span role="table" aria-label={payload.summary} className="@container flex flex-col">
      <Headings />
      {payload.rows.map((row) => (
        <Row key={row.key} row={row} />
      ))}
    </span>
  );
}
