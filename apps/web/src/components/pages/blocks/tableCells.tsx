import { DataText } from "@/components/ui/data-text";

// What the weather table and the sun table share: the frame of a row, and the
// Day · City columns both open with. One place for them, so the two tables
// cannot disagree about where a day or a city is.
//
// **Under `@md` a row is two lines**: its city and its day on the first, at
// the row's full width, and its values on the second. Side by side they do not
// fit a phone — the block is 273px wide in a 375px viewport and about 218px in
// a 320px one, and the fixed value columns alone are most of that. The step is
// on the table's own width (a container query), as the graphics' is. From
// `@md` the row is one line of columns, and `TABLE_VALUES` dissolves
// (`contents`) so its cells are columns of the row itself.
//
// No row has a minimum width, so a table fits its column rather than scrolling
// inside it. The city is what gives: it truncates, and the day beside it never
// does.

/** A table row's frame: two stacked lines under `@md`, one line of columns from it. */
export const TABLE_ROW =
  "flex w-full flex-col justify-center gap-0.5 border-b border-hairline px-3 @md:flex-row @md:items-center @md:justify-start @md:gap-2";

/** Wraps a row's value cells (or their headings): the second line under `@md`, spread across it. */
export const TABLE_VALUES = "flex items-center justify-between gap-1.5 @md:contents";

/**
 * The Day and City headings. Read but not drawn under `@md`: the line they
 * head there is a city's name beside "Day 3", which says what it is, and a
 * heading row of one line is what keeps its fixed height.
 */
export function PlaceHeadings() {
  return (
    <span role="presentation" className="sr-only flex items-center gap-2 @md:not-sr-only @md:min-w-0 @md:flex-1">
      <span role="columnheader" className="w-12 shrink-0">Day</span>
      <span role="columnheader" className="min-w-0 flex-1 truncate">City</span>
    </span>
  );
}

/**
 * A row's day and city. Day then City in the markup, which is the columns'
 * order from `@md`; under it the city leads its line and the day follows it,
 * as the graphics' rows read.
 */
export function PlaceCells({ label, city }: { label: string; city: string | null }) {
  return (
    <span
      role="presentation"
      className="flex min-w-0 flex-row-reverse items-baseline justify-end gap-2 @md:flex-1 @md:flex-row @md:items-center @md:justify-start"
    >
      <span role="rowheader" className="shrink-0 whitespace-nowrap @md:w-12">
        <DataText size="xs">{label}</DataText>
      </span>
      <span role="cell" className="min-w-0 truncate text-sm font-semibold text-ink @md:flex-1">
        {city ?? "—"}
      </span>
    </span>
  );
}
