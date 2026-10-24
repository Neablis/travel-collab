import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unsplashCreditHref } from "@tc/contracts";
import { tripCoverFactory } from "@tc/factories";
import type { DiscoverDay } from "@/lib/playbooks";
import { DiscoverCard, editorialSize } from "./DiscoverCard";

/** Every set of props a `next/link` was rendered with; the real link still renders. */
const linkProps = vi.hoisted(() => [] as { href?: unknown; prefetch?: unknown }[]);
vi.mock("next/link", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/link")>();
  return {
    ...real,
    default: (props: Parameters<typeof real.default>[0]) => {
      linkProps.push(props);
      return createElement(real.default, props);
    },
  };
});

// The card's stop rows (M27 link 10, `dc.html:2645`). What the server puts in
// `preview` is its own test (`savedDays.sequence.int.test.ts`); this one is
// that the card draws each row as the design does — time, then title — and
// draws a multi-day Playbook's rows exactly as it draws a one-day one's.

function day(over: Partial<DiscoverDay> = {}): DiscoverDay {
  return {
    savedDayId: "aa000000-0000-4000-8000-000000000001",
    ownerId: "dev-alice",
    ownerDisplayName: "Alice C.",
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
    cover: null,
    description: null,
    tags: [],
    namedTags: [],
    ...over,
  };
}

afterEach(cleanup);

/**
 * Each row as `[time cell, title]`, read off the screen. The time cell
 * carries a trailing space: it is the crawler's separator between time and
 * title, so the expectations spell it, not a typo.
 */
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
      ["6:30 am ", "Fushimi Inari before the crowds"],
      ["9 am ", "% Arabica, Higashiyama"],
      ["10:30 am ", "Kiyomizu-dera and Sannenzaka"],
    ]);
    // No "+N more": the design draws none, and the facts line already says 5.
    expect(screen.queryByText(/more/i)).toBeNull();
  });

  // Mitchell's rule for link 10: one layout for every Playbook. The rows carry
  // no `D1 ·` prefix and no day header — the facts line says "3 days".
  it("draws a multi-day Playbook's rows the same way", () => {
    render(<DiscoverCard day={day({ dayCount: 3, window: null })} origin={{ from: "playbooks" }} />);
    expect(rows()).toEqual([
      ["6:30 am ", "Fushimi Inari before the crowds"],
      ["9 am ", "% Arabica, Higashiyama"],
      ["10:30 am ", "Kiyomizu-dera and Sannenzaka"],
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

// Mitchell, PR #269 preview: at most three city chips, then one that counts
// the rest, so a many-city Playbook does not wrap its chips down the card.
describe("a Discover card's city chips", () => {
  const chipTexts = () => within(screen.getByTestId("city-chips")).getAllByRole("listitem").map((li) => li.textContent);

  it("draws every city when there are three or fewer, and no count", () => {
    render(<DiscoverCard day={day({ cities: ["Kyoto", "Uji", "Nara"] })} origin={{ from: "playbooks" }} />);
    expect(chipTexts()).toEqual(["Kyoto", "Uji", "Nara"]);
    expect(screen.queryByTestId("city-chips-more")).toBeNull();
  });

  it("draws three, then +N more naming the rest on hover", () => {
    render(
      <DiscoverCard
        day={day({ cities: ["Tokyo", "Hakone", "Kyoto", "Uji", "Nara", "Osaka", "Kobe"] })}
        origin={{ from: "playbooks" }}
      />,
    );
    expect(chipTexts()).toEqual(["Tokyo", "Hakone", "Kyoto", "+4 more"]);
    expect(screen.getByTestId("city-chips-more").getAttribute("title")).toBe("Uji, Nara, Osaka, Kobe");
  });

  it("never folds a matched city into the count", () => {
    render(
      <DiscoverCard
        day={day({ cities: ["Tokyo", "Hakone", "Kyoto", "Uji", "Nara"], matchedCities: ["Nara"] })}
        origin={{ from: "playbooks" }}
      />,
    );
    expect(chipTexts()).toEqual(["Nara", "Tokyo", "Hakone", "+2 more"]);
  });

  // SEO pass, D6: a chip is a way to its city's page, and a crawler's way from
  // a list of days to the places they are in.
  it("opens each city's page, and leaves a city whose name has no slug as text", () => {
    render(<DiscoverCard day={day({ cities: ["Kyoto", "京都"] })} origin={{ from: "playbooks" }} />);
    const chips = screen.getByTestId("city-chips");
    expect(within(chips).getByRole("link", { name: "Kyoto" }).getAttribute("href")).toBe("/playbooks/city/kyoto");
    expect(within(chips).queryByRole("link", { name: "京都" })).toBeNull();
    expect(chipTexts()).toEqual(["Kyoto", "京都"]);
  });
});

// Mitchell, 2026-10-02: the library names a person "Alice C." — first name and
// last initial, resolved by the server from the `users` row. The card prints
// that, and must not fall back to deriving a handle from `ownerId` ("Alice"),
// which is what it did while the library showed only handles.
describe("a Discover card's author", () => {
  it("is the name the server resolved, linking to their profile", () => {
    render(<DiscoverCard day={day()} origin={{ from: "playbooks" }} />);
    expect(screen.getByRole("link", { name: "Alice C." }).getAttribute("href")).toContain(
      "/playbooks/profile/dev-alice",
    );
  });
});

// M37 part 5, the approved `DiscoverCards` artboard: a cover leads the card,
// the city chips stand on its fade, and the credit sits under the facts line.
// Without one the card is exactly what it was.
describe("a Discover card's cover", () => {
  const cover = tripCoverFactory.build({ alt: "Lanterns along the Kamo river", photographerName: "Aiko Tanaka" });
  /** Whether `a` comes before `b` in the card. */
  const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const credit = () =>
    screen.queryByText((_, el) => el?.tagName === "P" && el.textContent === "Photo by Aiko Tanaka on Unsplash");

  it("leads with the photo, the chips on its fade, and credits it under the facts line", () => {
    render(<DiscoverCard day={day({ cover })} origin={{ from: "playbooks" }} />);
    const photo = screen.getByRole("img", { name: "Lanterns along the Kamo river" });
    const chips = screen.getByTestId("city-chips");
    const title = screen.getByRole("heading", { name: "Kyoto temples on foot" });
    expect(photo.getAttribute("loading")).toBe("lazy");
    // Photo, then the chips laid over its foot, then the title.
    expect(before(photo, chips)).toBe(true);
    expect(before(chips, title)).toBe(true);

    const line = credit();
    expect(line).not.toBeNull();
    expect(within(line!).getByRole("link", { name: "Aiko Tanaka" }).getAttribute("href")).toBe(
      unsplashCreditHref(cover.photographerUrl),
    );
    // Under the title's facts line, above the rating.
    expect(before(title, line!)).toBe(true);
    expect(before(line!, screen.getByTestId("card-rating"))).toBe(true);
  });

  it("is today's card without one: no photo, no credit, the chips first", () => {
    render(<DiscoverCard day={day()} origin={{ from: "playbooks" }} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(credit()).toBeNull();
    expect(before(screen.getByTestId("city-chips"), screen.getByRole("heading", { name: "Kyoto temples on foot" }))).toBe(
      true,
    );
  });
});

// axe on `/playbooks`, heading-order: every list of these cards sits straight
// under its screen's h1, and the card title was an h4.
describe("a Discover card's title", () => {
  it("is a level-two heading, the next level under the screen's h1", () => {
    render(<DiscoverCard day={day()} origin={{ from: "playbooks" }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Kyoto temples on foot" })).toBeTruthy();
  });
});

// M42 D9: what kind of day it is, and the tags that say so, from the server
// (`describeByTags`). Plain chips until the tag pages exist (part 5).
// A chip's label carries a trailing space: it is the crawler's separator
// between chips, so the expectations below spell it, not a typo.
describe("a Discover card's description", () => {
  it("describes the day under its title and shows its tags, most used first", () => {
    const described = day({ description: "Sightseeing", tags: ["sight", "meal"] });
    render(<DiscoverCard day={described} origin={{ from: "playbooks" }} />);
    expect(
      screen.getByRole("link", { name: "Kyoto temples on foot", description: "Sightseeing" }),
    ).toBeTruthy();
    const chips = within(screen.getByTestId(`tag-chips-${described.savedDayId}`)).getAllByTestId(/^tag-chip-/);
    expect(chips.map((chip) => chip.textContent)).toEqual(["Sight ", "Food "]);
  });

  // M42 part 5: a chip links to its tag's page only when the day's
  // description names the tag, which is when the page lists the day (ADR-070
  // §4). Four meals and a bar: Food links, and the Nightlife chip, whose page
  // does not list this day, is text.
  it("links a tag its description names, and leaves a tag it does not as text", () => {
    const foodie = day({ description: "Foodie", tags: ["meal", "nightlife"], namedTags: ["meal"] });
    render(<DiscoverCard day={foodie} origin={{ from: "playbooks" }} />);
    const chips = within(screen.getByTestId(`tag-chips-${foodie.savedDayId}`));
    expect(chips.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Food ", "/playbooks/tag/meal"],
    ]);
    expect(chips.getByTestId("tag-chip-nightlife").textContent).toBe("Nightlife ");
  });

  // A day whose description names nothing ("A bit of everything") is on no
  // tag page, and a chip for a tag no description names would lead to a 404.
  it("links no chip on a day whose description names no tag", () => {
    const mixed = day({ description: "A bit of everything", tags: ["shopping", "meal"], namedTags: [] });
    render(<DiscoverCard day={mixed} origin={{ from: "playbooks" }} />);
    const chips = within(screen.getByTestId(`tag-chips-${mixed.savedDayId}`));
    expect(chips.queryAllByRole("link")).toEqual([]);
    expect(chips.getAllByTestId(/^tag-chip-/).map((chip) => chip.textContent)).toEqual(["Shopping ", "Food "]);
  });

  it("says nothing, and draws no tags, for a day too lightly tagged to describe", () => {
    const bare = day();
    render(<DiscoverCard day={bare} origin={{ from: "playbooks" }} />);
    expect(screen.getByRole("link", { name: "Kyoto temples on foot", description: "" })).toBeTruthy();
    expect(screen.queryByTestId(`tag-chips-${bare.savedDayId}`)).toBeNull();
  });
});

// M50 part 6: Discover reads as a page someone laid out, not a uniform grid.
// One wide card in every five, first on the page, so a three-column row is a
// wide card and one beside it, then three; on two columns, a wide row then two
// pairs. Any other rhythm leaves a hole in one of the two grids.
describe("a Discover card's size", () => {
  it("is wide for the first card and every fifth after it, standard otherwise", () => {
    expect(Array.from({ length: 11 }, (_, i) => editorialSize(i))).toEqual([
      "wide", "standard", "standard", "standard", "standard",
      "wide", "standard", "standard", "standard", "standard",
      "wide",
    ]);
  });

  // `data-size` echoes the prop; the span is what makes a card wide, and jsdom
  // has no layout to measure it by, so the class is the cheapest pin.
  it("takes two columns from sm up when wide, and one when standard", () => {
    render(<DiscoverCard day={day()} origin={{ from: "playbooks" }} size="wide" />);
    expect(screen.getByTestId("discover-card").className.split(" ")).toContain("sm:col-span-2");
    cleanup();
    render(<DiscoverCard day={day()} origin={{ from: "playbooks" }} />);
    expect(screen.getByTestId("discover-card").getAttribute("data-size")).toBe("standard");
    expect(screen.getByTestId("discover-card").className.split(" ")).not.toContain("sm:col-span-2");
  });
});

// The card's title sits one level under whatever heads the list it is in: a
// profile's or a place page's cards sit under the h1, Discover's under the
// results' h2.
describe("a Discover card's title", () => {
  it("is a level-two heading unless the page puts a heading over its cards", () => {
    render(<DiscoverCard day={day()} origin={{ from: "playbooks" }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Kyoto temples on foot" })).toBeTruthy();
    cleanup();
    render(<DiscoverCard day={day()} origin={{ from: "playbooks" }} headingLevel={3} />);
    expect(screen.getByRole("heading", { level: 3, name: "Kyoto temples on foot" })).toBeTruthy();
  });
});

// A sea of 148 doors must not prefetch 148 day pages (ADR-063, M51's gate).
// `next/link` renders nothing for `prefetch={false}`, so the prop is read
// where it is handed over.
describe("a Discover card on the front door's sea", () => {
  it("opens its canonical page without prefetching it", () => {
    render(<DiscoverCard day={day()} origin={{ from: "sea", href: "/playbooks/day/kyoto-temples" }} />);
    const door = linkProps.find((props) => props.href === "/playbooks/day/kyoto-temples");
    expect(door?.prefetch).toBe(false);
  });

  // Mitchell's walk of PR 510: a one-column cell's chips ran to two and three
  // rows and pushed the title off the card's foot. A compact card draws the
  // chips one row holds and counts the rest.
  it("draws a small cell's cities on one row: two chips, and the rest counted", () => {
    render(
      <DiscoverCard
        day={day({ cities: ["Kyoto", "Uji", "Nara", "Osaka"] })}
        origin={{ from: "sea", href: "/playbooks/day/kyoto-temples" }}
        compact
      />,
    );
    const chips = within(screen.getByTestId("city-chips"));
    expect(chips.getAllByText(/^(Kyoto|Uji|Nara|Osaka)$/)).toHaveLength(2);
    expect(chips.getByTestId("city-chips-more").textContent).toBe("+2 more");
  });
});
