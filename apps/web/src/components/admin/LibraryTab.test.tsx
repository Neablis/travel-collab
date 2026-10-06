import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminNotebooksReport } from "@/lib/adminNotebooks";
import { LibraryTab } from "./LibraryTab";

// The Library tab's two states for notebooks (spec § States: `healthy` and
// `no-notebooks`), with Reports drawn first in both, and M36 D5's line: no
// tile, column or heading for a number with no source. The counts themselves
// are held against Postgres in `savedNotebooksAdmin.int.test.ts`.

afterEach(cleanup);

const NO_REPORTS = { open: [], actioned: [], dismissed: [] };

function report(overrides: Partial<AdminNotebooksReport> = {}): AdminNotebooksReport {
  return {
    windowDays: 30,
    saved: 1284,
    savedInWindow: 212,
    recent: [
      {
        savedNotebookId: "nb-1",
        title: "Kyoto in five slow days",
        ownerId: "user-malee",
        ownerEmail: "malee@example.com",
        savedAt: "2026-08-12T09:00:00.000Z",
      },
      {
        savedNotebookId: "nb-2",
        title: "Lisbon long weekend",
        ownerId: "dev-mei",
        ownerEmail: null,
        savedAt: "2026-09-02T09:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

// What the design draws that has no source (D21). None of it may appear, as a
// tile, a column or a heading — a zero would read as "nobody shares".
const UNSOURCED = [
  "Shared",
  "Saved by someone else",
  "Trips started from one",
  "Each week",
  "Notebooks that start the most trips",
];
const UNSOURCED_COLUMNS = ["Pages", "Shares", "Trips started", "Last used"];

describe("LibraryTab", () => {
  it("draws Reports, then the saved tile and the latest saves", () => {
    render(<LibraryTab reports={NO_REPORTS} notebooks={report()} />);

    const reports = screen.getByRole("heading", { name: "Reports" });
    const notebooks = screen.getByRole("region", { name: "Notebooks" });
    expect(reports.compareDocumentPosition(notebooks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const tile = screen.getByTestId("notebooks-saved");
    expect(within(tile).getByText("Saved to a library")).toBeTruthy();
    expect(within(tile).getByText("1,284")).toBeTruthy();
    expect(within(tile).getByText("+212")).toBeTruthy();

    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Notebook", "By", "Saved"]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["Kyoto in five slow days", "malee@example.com", "12 Aug"],
      ["Lisbon long weekend", "Mei", "2 Sep"],
    ]);
    expect(within(rows[0]!).getByRole("link", { name: "malee@example.com" }).getAttribute("href")).toBe(
      "/admin?tab=users&account=user-malee",
    );
  });

  it("draws no tile, column or heading for a number with no source", () => {
    render(<LibraryTab reports={NO_REPORTS} notebooks={report()} />);
    // The witness: the section rendered, so the absences below are about it.
    expect(screen.getByTestId("notebooks-saved")).toBeTruthy();
    for (const label of UNSOURCED) expect(screen.queryByText(label), label).toBeNull();
    for (const name of UNSOURCED_COLUMNS) expect(screen.queryByRole("columnheader", { name }), name).toBeNull();
    // The one place shares and trips started are named is the footer saying
    // they are not recorded.
    expect(screen.getByTestId("notebooks-footer").textContent).toMatch(/not recorded yet/);
  });

  it("shows no-notebooks in place of the section, and keeps Reports", () => {
    render(<LibraryTab reports={NO_REPORTS} notebooks={report({ saved: 0, savedInWindow: 0, recent: [] })} />);
    expect(screen.getByRole("heading", { name: "Reports" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No notebooks saved yet" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Notebooks" })).toBeNull();
    expect(screen.queryByTestId("notebooks-saved")).toBeNull();
  });
});
