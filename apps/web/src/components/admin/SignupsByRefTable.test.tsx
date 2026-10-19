import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SignupsByRefTable } from "./SignupsByRefTable";

// M50 decision 14: the go-to-market plan judges each channel by signups, and
// this table is where they are read, so a channel's three counts must sit in
// its own row and an unattributed signup must read as *direct*, not as blank.

afterEach(cleanup);

const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => cell.textContent);

describe("the signups-by-channel table", () => {
  it("gives each channel its 7-day, 30-day and all-time counts, and names a null ref direct", () => {
    render(
      <SignupsByRefTable
        rows={[
          { ref: "showhn", last7Days: 3, last30Days: 5, allTime: 9 },
          { ref: null, last7Days: 1, last30Days: 2, allTime: 40 },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "Signups by channel" });
    const [, showhn, direct] = within(table).getAllByRole("row");
    expect(cellsOf(showhn!)).toEqual(["showhn", "3", "5", "9"]);
    expect(cellsOf(direct!)).toEqual(["direct", "1", "2", "40"]);
  });

  it("says there are none rather than drawing an empty table", () => {
    render(<SignupsByRefTable rows={[]} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No signups yet.")).toBeTruthy();
  });
});
