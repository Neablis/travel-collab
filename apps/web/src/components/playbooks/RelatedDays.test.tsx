import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dayPath } from "@/lib/playbookUrls";
import { RELATED_DAYS, RelatedDays } from "./RelatedDays";

// What a crawler finds at the foot of a day: links to the next days to open.
// Which days the server picks is `publishedDaysPage`'s own test.

const CURRENT = "aa000000-0000-4000-8000-000000000000";
const day = (n: number) => ({ savedDayId: `aa000000-0000-4000-8000-00000000000${n}`, name: `Day ${n}` });
const current = { savedDayId: CURRENT, name: "This day" };

const linksIn = (title: string) =>
  within(screen.getByRole("region", { name: title }))
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);

afterEach(cleanup);

describe("RelatedDays", () => {
  it("links the city's days and the author's, without the day being read, at most four each", () => {
    render(
      <RelatedDays
        savedDayId={CURRENT}
        cityName="Kyoto"
        authorName="Alice C."
        sameCity={[current, day(1), day(2), day(3), day(4), day(5)]}
        sameAuthor={[day(6), current]}
      />,
    );

    expect(RELATED_DAYS).toBe(4);
    expect(linksIn("More in Kyoto")).toEqual([1, 2, 3, 4].map((n) => [`Day ${n}`, dayPath(day(n))]));
    expect(linksIn("More by Alice C.")).toEqual([["Day 6", dayPath(day(6))]]);
  });

  it("has no city list for a day that names no city", () => {
    render(<RelatedDays savedDayId={CURRENT} cityName={null} authorName="Alice C." sameCity={[day(1)]} sameAuthor={[day(2)]} />);

    expect(screen.queryByRole("region", { name: /More in/ })).toBeNull();
    expect(linksIn("More by Alice C.")).toEqual([["Day 2", dayPath(day(2))]]);
  });

  it("renders nothing when the only day either list holds is this one", () => {
    render(<RelatedDays savedDayId={CURRENT} cityName="Kyoto" authorName="Alice C." sameCity={[current]} sameAuthor={[current]} />);

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});
