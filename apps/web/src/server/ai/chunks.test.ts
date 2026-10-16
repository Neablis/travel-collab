import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SavedStop } from "@tc/contracts";
import { activityFactory, tripDetailFactory } from "@tc/factories";
import { buildDayChunkText, buildPlaybookDayChunks, buildTripDayChunks } from "./chunks";

// The chunk text is a contract with the embedding: these tests pin the exact
// bytes, because a format drift that "looks the same" still re-neighbours
// every vector in the corpus. If the format intentionally changes, these go
// red and the corpus gets re-embedded — that is the point.

function stop(overrides: Partial<SavedStop> & { title: string }): SavedStop {
  return {
    timeWindow: null,
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    dayIndex: 0,
    mode: null,
    endLocation: null,
    pendingReason: null,
    ...overrides,
  };
}

describe("buildDayChunkText", () => {
  it("renders a playbook-shaped day deterministically", () => {
    const text = buildDayChunkText({
      name: "Tokyo Food Crawl - Day 1",
      summary: "Three days of eating.",
      stops: [
        {
          title: "Senso-ji",
          notes: "Arrive before 9am.",
          tags: ["sight", "outdoors"],
          city: "Tokyo",
          countryCode: "JP",
        },
        {
          title: "Ichiran Ramen",
          notes: null,
          tags: ["meal"],
          city: "Tokyo",
          countryCode: "JP",
        },
      ],
      cities: ["Tokyo"],
    });
    expect(text).toBe(
      [
        "Tokyo Food Crawl - Day 1",
        "Summary: Three days of eating.",
        "Cities: Tokyo",
        "Stops:",
        "- Senso-ji [tags: sight, outdoors]",
        "  Notes: Arrive before 9am.",
        "  Tokyo, JP",
        "- Ichiran Ramen [tags: meal]",
        "  Tokyo, JP",
      ].join("\n"),
    );
  });

  it("renders a trip-shaped day: no summary, no cities line, country-only stop", () => {
    const text = buildDayChunkText({
      name: "Rome 2027 - Day 1 (2027-06-02)",
      summary: null,
      stops: [
        { title: "Colosseum", notes: null, tags: [], city: null, countryCode: "IT" },
      ],
      cities: [],
    });
    expect(text).toBe(
      ["Rome 2027 - Day 1 (2027-06-02)", "Stops:", "- Colosseum", "  IT"].join("\n"),
    );
  });

  it("marks an empty day instead of embedding a bare title", () => {
    const text = buildDayChunkText({ name: "Rest - Day 2", summary: null, stops: [], cities: [] });
    expect(text).toBe(["Rest - Day 2", "Stops:", "(no stops planned)"].join("\n"));
  });

  it("is byte-identical across calls", () => {
    const input = {
      name: "Kyoto - Day 1",
      summary: "Temples.",
      stops: [
        { title: "Fushimi Inari", notes: "Sunset hike.", tags: ["sight"], city: "Kyoto", countryCode: "JP" },
      ],
      cities: ["Kyoto"],
    };
    expect(buildDayChunkText(input)).toBe(buildDayChunkText(input));
  });
});

describe("buildPlaybookDayChunks", () => {
  const stops: SavedStop[] = [
    stop({
      title: "Senso-ji",
      notes: "Arrive before 9am.",
      tags: ["sight", "outdoors"],
      location: { name: "Senso-ji, Tokyo", city: "Tokyo", countryCode: "JP" },
      dayIndex: 0,
    }),
    stop({
      title: "Ichiran Ramen",
      tags: ["meal"],
      location: { name: "Ichiran, Tokyo", city: "Tokyo", countryCode: "JP" },
      dayIndex: 0,
    }),
    stop({
      title: "Fushimi Inari",
      notes: "Sunset hike.",
      tags: ["sight"],
      location: { name: "Fushimi Inari, Kyoto", city: "Kyoto", countryCode: "JP" },
      dayIndex: 1,
    }),
  ];

  it("groups stops by dayIndex and chunks the empty day too", () => {
    const chunks = buildPlaybookDayChunks({
      name: "Tokyo Food Crawl",
      summary: "Three days of eating.",
      stops,
      dayCount: 3,
    });
    expect(chunks.map((c) => c.dayIndex)).toEqual([0, 1, 2]);
    expect(chunks[0]!.text).toBe(
      [
        "Tokyo Food Crawl - Day 1",
        "Summary: Three days of eating.",
        "Cities: Tokyo",
        "Stops:",
        "- Senso-ji [tags: sight, outdoors]",
        "  Notes: Arrive before 9am.",
        "  Tokyo, JP",
        "- Ichiran Ramen [tags: meal]",
        "  Tokyo, JP",
      ].join("\n"),
    );
    expect(chunks[1]!.text).toBe(
      [
        "Tokyo Food Crawl - Day 2",
        "Summary: Three days of eating.",
        "Cities: Kyoto",
        "Stops:",
        "- Fushimi Inari [tags: sight]",
        "  Notes: Sunset hike.",
        "  Kyoto, JP",
      ].join("\n"),
    );
    // The gap in dayIndex is a rest day (ADR-048 decision 2): it gets a
    // chunk that says so, not silence that drops it from the corpus.
    expect(chunks[2]!.text).toBe(
      ["Tokyo Food Crawl - Day 3", "Summary: Three days of eating.", "Stops:", "(no stops planned)"].join("\n"),
    );
  });

  it("derives per-day metadata: tags de-duplicated, primary city from the first located stop", () => {
    const chunks = buildPlaybookDayChunks({
      name: "Tokyo Food Crawl",
      summary: null,
      stops,
      dayCount: 3,
    });
    expect(chunks[0]).toMatchObject({
      dayIndex: 0,
      city: "Tokyo",
      countryCode: "JP",
      tags: ["sight", "outdoors", "meal"],
    });
    expect(chunks[2]).toMatchObject({ dayIndex: 2, city: null, countryCode: null, tags: [] });
  });
});

describe("buildTripDayChunks", () => {
  it("renders one chunk per trip day with the date in the label", () => {
    const colosseumId = randomUUID();
    const detail = tripDetailFactory.build({
      name: "Rome 2027",
      days: [{ dayId: randomUUID(), activityIds: [colosseumId], date: "2027-06-02", costSubtotal: 0 }],
      activities: {
        [colosseumId]: activityFactory.build({
          activityId: colosseumId,
          title: "Colosseum",
          notes: "Book the underground tour.",
          tags: ["sight", "ticketed"],
          location: { name: "Colosseum, Rome", city: "Rome", countryCode: "IT" },
        }),
      },
    });
    const chunks = buildTripDayChunks(detail);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe(
      [
        "Rome 2027 - Day 1 (2027-06-02)",
        "Cities: Rome",
        "Stops:",
        "- Colosseum [tags: sight, ticketed]",
        "  Notes: Book the underground tour.",
        "  Rome, IT",
      ].join("\n"),
    );
    expect(chunks[0]).toMatchObject({
      dayIndex: 0,
      city: "Rome",
      countryCode: "IT",
      tags: ["sight", "ticketed"],
    });
  });
});
