import { describe, expect, it } from "vitest";
import {
  cityDescription,
  countryCityDescription,
  countryCityTitle,
  countryDescription,
  dayArcHighlights,
  dayDescription,
  dayFactsLine,
  dayHook,
  dayIndexable,
  featuredByCity,
  placeHook,
  placeTitle,
  tagDescription,
  tagTitle,
  type DayFacts,
  type SeoDay,
} from "./playbooksPreview";

const facts: DayFacts = { cities: ["Kyoto", "Osaka"], dayCount: 3, stopCount: 12, author: "Dana R.", rating: null, reviewCount: 0 };

describe("dayFactsLine", () => {
  it("names the cities, the days past one, the stops and the author", () => {
    expect(dayFactsLine(facts)).toBe("Kyoto, Osaka · 3 days · 12 stops · by Dana R.");
    expect(dayFactsLine({ ...facts, cities: ["Kyoto"], dayCount: 1, stopCount: 1 })).toBe("Kyoto · 1 stop · by Dana R.");
  });

  it("opens on the stops when the day names no city", () => {
    expect(dayFactsLine({ ...facts, cities: [] })).toBe("3 days · 12 stops · by Dana R.");
  });

  it("states a rating only once somebody has left one", () => {
    expect(dayFactsLine({ ...facts, rating: 4.6, reviewCount: 12 })).toBe(
      "Kyoto, Osaka · 3 days · 12 stops · by Dana R. · rated 4.6 from 12 reviews",
    );
    expect(dayFactsLine({ ...facts, rating: 4.6, reviewCount: 0 })).not.toContain("rated");
  });
});

describe("dayDescription", () => {
  it("is the author's own summary when the day has one", () => {
    expect(dayDescription("  Temples before the crowds, then the river. ", facts)).toBe("Temples before the crowds, then the river.");
  });

  it("is the facts line for a day with no summary, or a blank one", () => {
    expect(dayDescription(null, facts)).toBe(dayFactsLine(facts));
    expect(dayDescription("", facts)).toBe(dayFactsLine(facts));
    expect(dayDescription(" \n ", facts)).toBe(dayFactsLine(facts));
  });
});

// The list pages' titles and descriptions (SEO pass, 2026-10-24): each page
// type's sentence is shaped by what the page is, and every sentence reads
// the searcher's words. The fixtures are invented days, not real listings.
const amalfi: SeoDay = {
  name: "Amalfi by gozzo",
  description: null,
  preview: [
    { title: "Capri by private gozzo" },
    { title: "Lunch at Il Riccio" },
    { title: "Coffee at Pasticceria Pansa" },
    { title: "Swim at Li Galli" },
  ],
  cities: ["Amalfi"],
};
const rome: SeoDay = {
  name: "Rome in a day",
  description: null,
  preview: [{ title: "Ancient mornings" }],
  cities: ["Rome"],
};
const florence: SeoDay = {
  name: "Florence on foot",
  description: null,
  preview: [{ title: "The Accademia's first slot" }, { title: "The Uffizi after" }, { title: "The Oltrarno's workshops" }],
  cities: ["Florence"],
};
const hvar: SeoDay = {
  name: "Hvar by skipper",
  description: null,
  preview: [{ title: "A skipper day around the Pakleni islands" }, { title: "Swimming stops" }, { title: "A long lunch" }],
  cities: ["Hvar"],
};

describe("dayArcHighlights", () => {
  it("takes the first stop of the morning, the midday and the evening, in day order", () => {
    expect(
      dayArcHighlights([
        { title: "Mint tea on the terrace", timeWindow: { start: "08:30" } },
        { title: "Ben Youssef Madrasa", timeWindow: { start: "09:30" } },
        { title: "Lunch in the medina", timeWindow: { start: "13:00" } },
        { title: "Rooftop at the adhan", timeWindow: { start: "19:00" } },
      ]),
    ).toEqual(["Mint tea on the terrace", "Lunch in the medina", "Rooftop at the adhan"]);
  });

  it("arcs an untimed day from its first stop, and a stop-less day from nothing", () => {
    expect(dayArcHighlights([{ title: "Wander Gion", timeWindow: null }])).toEqual(["Wander Gion"]);
    expect(dayArcHighlights([])).toEqual([]);
  });

  it("names a repeated title once, and reads an em dash as a comma", () => {
    expect(
      dayArcHighlights([
        { title: "Breakfast", timeWindow: { start: "08:00" } },
        { title: "Rome — the Forum", timeWindow: { start: "14:00" } },
        { title: "Breakfast", timeWindow: { start: "19:00" } },
      ]),
    ).toEqual(["Breakfast", "Rome, the Forum"]);
  });

  it("takes the next distinct stop in a bucket rather than repeating an earlier title", () => {
    expect(
      dayArcHighlights([
        { title: "Breakfast", timeWindow: { start: "08:00" } },
        { title: "Lunch", timeWindow: { start: "13:00" } },
        { title: "Breakfast", timeWindow: { start: "19:00" } },
        { title: "Dinner", timeWindow: { start: "20:00" } },
      ]),
    ).toEqual(["Breakfast", "Lunch", "Dinner"]);
  });
});

describe("dayDescription's arc fallback", () => {
  it("is still the author's summary when the day has one, stops or not", () => {
    expect(dayDescription("Temples before the crowds.", facts, [{ title: "Mint tea", timeWindow: { start: "08:30" } }])).toBe(
      "Temples before the crowds.",
    );
  });

  it("is the arc sentence for a summary-less day, and the facts line when there is nothing to arc from", () => {
    expect(
      dayDescription(null, facts, [
        { title: "Mint tea on the terrace", timeWindow: { start: "08:30" } },
        { title: "Lunch in the medina", timeWindow: { start: "13:00" } },
        { title: "Rooftop at the adhan", timeWindow: { start: "19:00" } },
      ]),
    ).toBe(
      "A day in Kyoto: Mint tea on the terrace, Lunch in the medina, Rooftop at the adhan, planned by someone who lived it. Borrow it for your trip.",
    );
    expect(dayDescription(null, facts, [])).toBe(dayFactsLine(facts));
    expect(dayDescription(null, facts)).toBe(dayFactsLine(facts));
  });

  it("drops the 'in <city>' when the day names no city, so no sentence dangles", () => {
    expect(dayDescription(null, { ...facts, cities: [] }, [{ title: "Wander Gion", timeWindow: null }])).toBe(
      "A day: Wander Gion, planned by someone who lived it. Borrow it for your trip.",
    );
  });
});

describe("dayHook and placeHook", () => {
  it("hooks a day on its first three preview stops, deduped, and a place on its first", () => {
    expect(dayHook(amalfi)).toBe("Capri by private gozzo, Lunch at Il Riccio, Coffee at Pasticceria Pansa");
    expect(placeHook(amalfi)).toBe("Capri by private gozzo");
    expect(dayHook({ ...amalfi, preview: [{ title: "Swim" }, { title: "Swim" }, { title: "Lunch" }] })).toBe("Swim, Lunch");
  });

  it("falls back to the day's own sentence, then its name, and never keeps an em dash", () => {
    expect(dayHook({ ...amalfi, preview: [] })).toBe("Amalfi by gozzo");
    expect(dayHook({ ...amalfi, preview: [], description: "Gozzo days — slow ones." })).toBe("Gozzo days, slow ones.");
    expect(placeHook({ ...amalfi, preview: [] })).toBe("Amalfi by gozzo");
  });

  it("falls through a dash-only title as if it were missing, never an empty hook", () => {
    expect(dayHook({ ...amalfi, preview: [{ title: "—" }, { title: "Capri by private gozzo" }] })).toBe("Capri by private gozzo");
    expect(dayHook({ ...amalfi, preview: [{ title: "—" }] })).toBe("Amalfi by gozzo");
    expect(dayHook({ ...amalfi, preview: [{ title: "—" }], description: "Gozzo days — slow ones." })).toBe(
      "Gozzo days, slow ones.",
    );
    expect(placeHook({ ...amalfi, preview: [{ title: "—" }] })).toBe("Amalfi by gozzo");
  });
});

describe("featuredByCity", () => {
  it("takes one day per distinct first city, in list order, up to the limit", () => {
    expect(featuredByCity([amalfi, { ...amalfi, name: "Amalfi again" }, rome, florence], 2)).toEqual([
      { city: "Amalfi", day: amalfi },
      { city: "Rome", day: rome },
    ]);
    expect(featuredByCity([{ ...amalfi, cities: [] }, rome], 3)).toEqual([{ city: "Rome", day: rome }]);
  });
});

describe("list page titles", () => {
  it("names a place's trips from real travelers, and a pair with its country anchor", () => {
    expect(placeTitle("Amalfi Coast")).toBe("Amalfi Coast trips from real travelers");
    expect(placeTitle("Italy")).toBe("Italy trips from real travelers");
    expect(countryCityTitle("Florence", "Italy")).toBe("Florence, Italy: trips from real travelers");
  });

  it("names a theme's days worth borrowing globally, and in its place when scoped", () => {
    expect(tagTitle("Beach", null, null)).toBe("Beach days worth borrowing");
    expect(tagTitle("Beach", "Hvar", null)).toBe("Beach days in Hvar");
    expect(tagTitle("Beach", null, "Croatia")).toBe("Beach days in Croatia");
    expect(tagTitle("Beach", "Hvar", "Croatia")).toBe("Beach days in Hvar, Croatia");
  });
});

describe("list page descriptions", () => {
  it("goes deep on a city's featured day, then its count", () => {
    expect(cityDescription("Amalfi", 14, [amalfi])).toBe(
      "Amalfi, from people who've been: Capri by private gozzo, Lunch at Il Riccio, Coffee at Pasticceria Pansa. 14 days you can drop into your trip.",
    );
    expect(cityDescription("Amalfi", 1, [amalfi])).toContain("1 day you can drop into your trip.");
  });

  it("ranges a country over its cities, one hook each, up to three", () => {
    expect(countryDescription("Italy", 40, [rome, florence, amalfi])).toBe(
      "Italy in real days: Rome's Ancient mornings, Florence's The Accademia's first slot, Amalfi's Capri by private gozzo. Pick a day and drop it into your trip.",
    );
  });

  it("anchors a country×city day in its city and closes on borrowing", () => {
    expect(countryCityDescription("Florence", 9, [florence])).toBe(
      "Florence, from people who've been: The Accademia's first slot, The Uffizi after, The Oltrarno's workshops. 9 days you can borrow for your trip.",
    );
  });

  it("ranges a global theme over places, and goes deep on a city's theme", () => {
    expect(tagDescription("Beach", null, null, 20, [hvar, { ...hvar, cities: ["Bondi"], preview: [{ title: "Bondi to Bronte walk" }] }])).toBe(
      "Beach days from real trips: Hvar's A skipper day around the Pakleni islands, Bondi's Bondi to Bronte walk. Borrow one for your next trip.",
    );
    expect(tagDescription("Beach", "Hvar", null, 5, [hvar])).toBe(
      "Hvar beach: A skipper day around the Pakleni islands, Swimming stops, A long lunch. A real day, ready to drop into your trip.",
    );
  });

  it("names a country's theme places, and a city×country theme with its country anchor", () => {
    const dubrovnik: SeoDay = { ...hvar, cities: ["Dubrovnik"], preview: [{ title: "The walls at dawn" }] };
    const rovinj: SeoDay = { ...hvar, cities: ["Rovinj"], preview: [{ title: "Rovinj at dusk" }] };
    expect(tagDescription("Beach", null, "Croatia", 12, [hvar, dubrovnik, rovinj])).toBe(
      "Croatia's beach, from real trips: Hvar, Dubrovnik, Rovinj. Beach days you can borrow.",
    );
    expect(tagDescription("Beach", "Hvar", "Croatia", 3, [hvar])).toBe(
      "Hvar, Croatia beach: A skipper day around the Pakleni islands, Swimming stops, A long lunch. A real day, ready to drop into your trip.",
    );
  });

  it("features the page's own first day, so a second page reads differently", () => {
    expect(cityDescription("Amalfi", 14, [amalfi])).not.toBe(cityDescription("Amalfi", 14, [rome]));
  });

  // The no-steal rule governs generated sentences, not quoted titles: the
  // templates never say it, but a user's own title is quoted, not censored
  // (rewriting it would misquote their day). If Mitchell wants the strong
  // rule, the builders must normalize the word — that is his call.
  it("templates never say steal or carry an em dash", () => {
    const dashed: SeoDay = { ...amalfi, preview: [{ title: "Capri — by gozzo" }] };
    for (const sentence of [
      cityDescription("Amalfi", 14, [dashed]),
      countryDescription("Italy", 40, [dashed]),
      countryCityDescription("Florence", 9, [dashed]),
      tagDescription("Beach", null, null, 20, [dashed]),
      tagDescription("Beach", "Hvar", null, 5, [dashed]),
      tagDescription("Beach", null, "Croatia", 12, [dashed]),
      tagDescription("Beach", "Hvar", "Croatia", 3, [dashed]),
    ]) {
      expect(sentence).not.toContain("—");
      expect(sentence).not.toContain("steal");
    }
  });

  it("quotes a user's own title verbatim, steal and all", () => {
    expect(dayHook({ ...amalfi, preview: [{ title: "Steal the sunset" }] })).toBe("Steal the sunset");
  });
});

describe("dayIndexable", () => {
  const hidden = { moderatedAt: "2026-09-23T00:00:00.000Z", moderationNote: null };

  it("is true only for a published day no operator has hidden", () => {
    expect(dayIndexable({ day: { visibility: "public" }, moderation: null })).toBe(true);
    // The author's own read of a private day, and of a published day an operator hid.
    expect(dayIndexable({ day: { visibility: "private" }, moderation: null })).toBe(false);
    expect(dayIndexable({ day: { visibility: "public" }, moderation: hidden })).toBe(false);
  });
});
