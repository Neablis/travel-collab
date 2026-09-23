import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoverDay } from "@/lib/playbooks";
import { DiscoverCard } from "./DiscoverCard";

// The card's stop rows (M27 link 10, `dc.html:2645`). What the server puts in
// `preview` is its own test (`savedDays.sequence.int.test.ts`); this one is
// that the card draws each row as the design does — time, then title — and
// draws a multi-day Playbook's rows exactly as it draws a one-day one's.

function day(over: Partial<DiscoverDay> = {}): DiscoverDay {
  return {
    savedDayId: "aa000000-0000-4000-8000-000000000001",
    ownerId: "dev-alice",
    name: "Kyoto temples on foot",
    cities: ["Kyoto"],
    matchedCities: [],
    stopCount: 5,
    dayCount: 1,
    window: { start: "06:30", end: "18:30" },
    preview: [
      { title: "Fushimi Inari before the crowds", start: "06:30" },
      { title: "% Arabica, Higashiyama", start: "09:00" },
      { title: "Kiyomizu-dera and Sannenzaka", start: "10:30" },
    ],
    totalCost: null,
    adds: 2,
    rating: null,
    reviewCount: 0,
    visibility: "public",
    authorKind: "human",
    sourceTripName: "Japan",
    createdAt: "2026-08-01T00:00:00.000Z",
    publishedAt: "2026-08-02T00:00:00.000Z",
    isMine: false,
    ...over,
  };
}

afterEach(cleanup);

/** Each row as `[time cell, title]`, read off the screen. */
function rows(): [string, string][] {
  return within(screen.getByTestId("discover-preview"))
    .getAllByRole("listitem")
    .map((row) => [
      within(row).getByTestId("preview-time").textContent ?? "",
      within(row).getByTestId("preview-title").textContent ?? "",
    ]);
}

describe("a Discover card's stop preview", () => {
  it("draws each stop as its clock time and its title, in order", () => {
    render(<DiscoverCard day={day()} origin={{ from: "playbooks" }} />);
    expect(rows()).toEqual([
      ["6:30 am", "Fushimi Inari before the crowds"],
      ["9 am", "% Arabica, Higashiyama"],
      ["10:30 am", "Kiyomizu-dera and Sannenzaka"],
    ]);
    // No "+N more": the design draws none, and the facts line already says 5.
    expect(screen.queryByText(/more/i)).toBeNull();
  });

  // Mitchell's rule for link 10: one layout for every Playbook. The rows carry
  // no `D1 ·` prefix and no day header — the facts line says "3 days".
  it("draws a multi-day Playbook's rows the same way", () => {
    render(<DiscoverCard day={day({ dayCount: 3, window: null })} origin={{ from: "playbooks" }} />);
    expect(rows()).toEqual([
      ["6:30 am", "Fushimi Inari before the crowds"],
      ["9 am", "% Arabica, Higashiyama"],
      ["10:30 am", "Kiyomizu-dera and Sannenzaka"],
    ]);
  });

  it("leaves the time cell empty for a stop with no time, rather than inventing one", () => {
    render(<DiscoverCard day={day({ preview: [{ title: "Wander Gion", start: null }] })} origin={{ from: "playbooks" }} />);
    expect(rows()).toEqual([["", "Wander Gion"]]);
  });

  it("draws no preview block at all for a day with no stops", () => {
    render(<DiscoverCard day={day({ stopCount: 0, window: null, preview: [] })} origin={{ from: "playbooks" }} />);
    expect(screen.queryByTestId("discover-preview")).toBeNull();
  });
});

// M12 link 5: the card carries the day's rating. What the server puts in
// `rating` and `reviewCount` is the reviews int tests'; this is that the card
// states it — and that a day nobody has reviewed says so rather than printing
// `0.0`, the lowest score there is, for a day nobody has judged.
describe("a Discover card's rating", () => {
  it("states the average and how many reviews it is over", () => {
    render(<DiscoverCard day={day({ rating: 4.6, reviewCount: 12 })} origin={{ from: "playbooks" }} />);
    expect(screen.getByTestId("card-rating").textContent).toBe("★ 4.6 · 12 reviews");
  });

  it("says one review, not one reviews", () => {
    render(<DiscoverCard day={day({ rating: 5, reviewCount: 1 })} origin={{ from: "playbooks" }} />);
    expect(screen.getByTestId("card-rating").textContent).toBe("★ 5.0 · 1 review");
  });

  it("says a day with no reviews has none, and shows no number", () => {
    render(<DiscoverCard day={day({ rating: null, reviewCount: 0 })} origin={{ from: "playbooks" }} />);
    const rating = screen.getByTestId("card-rating");
    expect(rating.textContent).toBe("No reviews yet");
    expect(rating.textContent).not.toMatch(/\d/);
  });
});
