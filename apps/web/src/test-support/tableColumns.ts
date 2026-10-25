import { screen, within } from "@testing-library/react";
import { accessibleNames } from "./accessibleNames";

// A `role="table"` row read the way a screen reader reads it: each cell under
// the column header at its position, the row header first. The widget tables
// name their columns with headers — drawn, or read and not drawn — and never
// with an `aria-label` on the cell (KI-2026-10-01-a), so a test that finds a
// cell finds it the way a reader does: by the header over it.

const cellsOf = (row: HTMLElement) => [...within(row).queryAllByRole("rowheader"), ...within(row).queryAllByRole("cell")];

const columnHeaders = () => accessibleNames(screen.getByRole("table"), "columnheader");

/** Each column header over `row`, mapped to the accessible name of the cell beneath it — what a reader hears for that column. */
export function columnNames(row: HTMLElement): Record<string, string> {
  const headers = columnHeaders();
  const names = [...accessibleNames(row, "rowheader"), ...accessibleNames(row, "cell")];
  if (names.length !== headers.length) throw new Error(`${headers.length} column headers over a row of ${names.length} cells`);
  return Object.fromEntries(headers.map((header, i) => [header, names[i]!]));
}

/** The cell in `row` under the column header named `column`. */
export function cellIn(row: HTMLElement, column: string): HTMLElement {
  const i = columnHeaders().indexOf(column);
  const cell = cellsOf(row)[i];
  if (i < 0 || !cell) throw new Error(`no cell under a "${column}" column header`);
  return cell;
}
