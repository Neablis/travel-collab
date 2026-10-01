import type { SunPayload, SunRow } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";

// The sun block as a table: the same rows the graphic draws, read as
// Day · City · Sunrise · Sunset · Daylight. The golden hour has no column: it
// is drawn on the graphic and not written anywhere.
//
// One place for each column's width, so the heading row and the data rows
// cannot disagree about where a column is. The city is the column that gives:
// it flexes and truncates, and no row has a minimum width, so the table fits
// its column rather than scrolling inside it.
//
// **Under `@md` the day sits beneath its city**, as the weather table's does.
// The fixed columns are then 216px, and 260px with their gaps, padding and the
// frame's border, so the city keeps 60px at 320 and 115px at 375.
//
// A row has a minimum height, not a fixed one, as the graphic's has: a time
// with "(next day)" after it, or a polar day's words, wraps inside its column.
const COL = {
  // Day and City together: one stacked column when narrow, two when not.
  place: "flex min-w-0 flex-1 flex-col-reverse leading-tight @md:flex-row @md:items-center @md:gap-2",
  day: "shrink-0 @md:w-12",
  city: "min-w-0 truncate @md:flex-1",
  // "(next day)" is ten mono characters: 72px at text-xs, 84px at text-sm.
  time: "w-20 shrink-0 @md:w-24",
  // "14h 35m" is seven mono characters: 51px at text-xs, 59px at text-sm.
  daylight: "w-14 shrink-0 text-right @md:w-16",
} as const;
const ROW = "flex w-full items-center gap-1.5 border-b border-hairline px-3 @md:gap-2";
const VALUE = "text-xs leading-tight @md:text-sm";

const POLAR = { "up-all-day": "sun up all day", "down-all-day": "sun down all day" } as const;

function Value({ text, label, width }: { text: string; label: string; width: string }) {
  return (
    <span role="cell" aria-label={label} className={width}>
      <DataText className={cn(VALUE, text !== "—" && "text-ink")}>{text}</DataText>
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
      <span role="columnheader" className={COL.time}>Sunrise</span>
      <span role="columnheader" className={COL.time}>Sunset</span>
      <span role="columnheader" className={COL.daylight}>Daylight</span>
    </span>
  );
}

function Row({ row }: { row: SunRow }) {
  // A polar day takes the sunrise column for the one fact there is, and leaves
  // the sunset column a dash: a column that moves per row is not a column.
  const polar = row.state === "normal" ? null : POLAR[row.state];
  return (
    <span role="row" data-state={row.state} className={cn(ROW, "min-h-10 py-1 last:border-b-0")}>
      <span role="presentation" className={COL.place}>
        <span role="rowheader" className={COL.day}>
          <DataText size="xs">{row.label}</DataText>
        </span>
        <span role="cell" className={cn(COL.city, "text-sm font-semibold text-ink")}>
          {row.city ?? "—"}
        </span>
      </span>
      <Value text={polar ?? row.sunrise ?? "—"} label="sunrise" width={COL.time} />
      <Value text={row.sunset ?? "—"} label="sunset" width={COL.time} />
      <Value text={row.daylight} label="daylight" width={COL.daylight} />
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
