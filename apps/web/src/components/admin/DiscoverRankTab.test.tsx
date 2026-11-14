import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoverRankRow } from "@/lib/adminDiscoverRank";
import { DiscoverRankTab } from "./DiscoverRankTab";

afterEach(cleanup);

const CONSTANTS = { addWeight: 3, qualityMax: 1.3 };

const ROW: DiscoverRankRow = {
  savedDayId: "11111111-1111-4111-8111-111111111111",
  title: "Lisbon in a day",
  score: 12.3456,
  addsRecent: 3.5,
  commentsRecent: 1.25,
  quality: 1.1,
  newDayLift: 0.75,
  computedAt: "2052-06-29T12:00:00.000Z",
};

describe("the Discover rank tab", () => {
  it("lists each day with its title linked and every component of its score", () => {
    render(<DiscoverRankTab rows={[ROW]} constants={CONSTANTS} />);
    const link = screen.getByRole("link", { name: "Lisbon in a day" });
    expect(link.getAttribute("href")).toBe(`/playbooks/day/${ROW.savedDayId}`);
    const row = within(screen.getByRole("row", { name: /Lisbon in a day/ }));
    for (const cell of ["12.35", "3.50", "1.25", "1.10", "0.75"]) expect(row.getByText(cell), cell).toBeTruthy();
    expect(row.getByText("29 Jun 12:00 UTC").getAttribute("datetime")).toBe(ROW.computedAt);
    for (const name of ["Score", "Adds", "Comments", "Quality", "New-day lift", "Computed"]) {
      expect(screen.getByRole("columnheader", { name }), name).toBeTruthy();
    }
  });

  it("names the table and scopes each header to its column", () => {
    render(<DiscoverRankTab rows={[ROW]} constants={CONSTANTS} />);
    expect(screen.getByRole("table", { name: "Top ranked days" })).toBeTruthy();
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.getAttribute("scope"), header.textContent ?? "").toBe("col");
    }
  });

  it("states each constant it is given, name and value", () => {
    render(<DiscoverRankTab rows={[ROW]} constants={CONSTANTS} />);
    const items = within(screen.getByRole("list", { name: "Constants in force" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["addWeight3", "qualityMax1.3"]);
  });

  it("says the cron has not run when there are no rows", () => {
    render(<DiscoverRankTab rows={[]} constants={CONSTANTS} />);
    expect(screen.getByRole("heading", { name: "No ranks yet" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
