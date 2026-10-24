import { describe, expect, it } from "vitest";
import { dayDescription } from "./playbooksPreview";
import { breadcrumbJsonLd, dayJsonLd, organizationJsonLd, placeItemListJsonLd, serializeJsonLd, webSiteJsonLd } from "./jsonLd";

const ORIGIN = "https://caesura.today";
const DAY = {
  origin: ORIGIN,
  path: "/playbooks/day/a-slow-day-abc",
  name: "A slow day",
  description: "Temples, then the river.",
  author: "Dana R.",
  stops: ["Kiyomizu-dera", "Nishiki Market"],
};

describe("landing structured data", () => {
  it("names the organisation and the site at the origin", () => {
    expect(organizationJsonLd(ORIGIN)).toMatchObject({ "@type": "Organization", name: "Caesura", url: ORIGIN });
    expect(webSiteJsonLd(ORIGIN)).toMatchObject({ "@type": "WebSite", name: "Caesura", url: ORIGIN });
  });
});

describe("dayJsonLd", () => {
  it("is a TouristTrip with its stops in order, by the author's public name", () => {
    const [trip] = dayJsonLd(DAY);
    expect(trip).toMatchObject({
      "@type": "TouristTrip",
      name: "A slow day",
      url: `${ORIGIN}/playbooks/day/a-slow-day-abc`,
      provider: { "@type": "Person", name: "Dana R." },
    });
    expect((trip as { itinerary: { itemListElement: unknown[] } }).itinerary.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, item: { "@type": "TouristAttraction", name: "Kiyomizu-dera" } },
      { "@type": "ListItem", position: 2, item: { "@type": "TouristAttraction", name: "Nishiki Market" } },
    ]);
  });

  it("carries no aggregateRating, which schema.org does not allow on a Trip", () => {
    expect(dayJsonLd(DAY)[0]).not.toHaveProperty("aggregateRating");
  });

  it("carries the description it is given, so an empty city list never leaves a dangling 'in '", () => {
    const description = dayDescription(null, {
      cities: [],
      dayCount: 1,
      stopCount: 3,
      author: "Dana R.",
      rating: null,
      reviewCount: 0,
    });
    expect(description).toBe("3 stops · by Dana R.");
    expect(dayJsonLd({ ...DAY, description })[0]).toMatchObject({ description: "3 stops · by Dana R." });
  });

  it("writes every url absolute, from the origin", () => {
    const [trip, crumbs] = dayJsonLd({ ...DAY, city: { name: "Kyoto", path: "/playbooks/city/kyoto" } });
    const urls = [
      (trip as { url: string }).url,
      ...(crumbs as { itemListElement: { item: string }[] }).itemListElement.map((c) => c.item),
    ];
    expect(urls).toHaveLength(4);
    for (const url of urls) expect(url.startsWith(`${ORIGIN}/`)).toBe(true);
    expect((organizationJsonLd(ORIGIN) as { logo: string }).logo).toBe(`${ORIGIN}/icon.svg`);
  });

  it("breadcrumbs through Playbooks to the day, and through the city when given one", () => {
    const names = (nodes: ReturnType<typeof dayJsonLd>) =>
      (nodes[1] as { itemListElement: { name: string; item: string }[] }).itemListElement.map((c) => [c.name, c.item]);
    expect(names(dayJsonLd(DAY))).toEqual([
      ["Playbooks", `${ORIGIN}/playbooks`],
      ["A slow day", `${ORIGIN}/playbooks/day/a-slow-day-abc`],
    ]);
    expect(names(dayJsonLd({ ...DAY, city: { name: "Kyoto", path: "/playbooks/city/kyoto" } }))).toEqual([
      ["Playbooks", `${ORIGIN}/playbooks`],
      ["Kyoto", `${ORIGIN}/playbooks/city/kyoto`],
      ["A slow day", `${ORIGIN}/playbooks/day/a-slow-day-abc`],
    ]);
  });
});

describe("breadcrumbJsonLd", () => {
  it("lists the visible trail in order, each crumb at its absolute page-one URL", () => {
    expect(
      breadcrumbJsonLd(
        [
          { name: "Playbooks", path: "/playbooks" },
          { name: "Italy", path: "/playbooks/country/italy" },
          { name: "Rome", path: "/playbooks/country/italy/city/rome" },
          { name: "Food", path: "/playbooks/country/italy/city/rome/tag/meal" },
        ],
        ORIGIN,
      ),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Playbooks", item: `${ORIGIN}/playbooks` },
        { "@type": "ListItem", position: 2, name: "Italy", item: `${ORIGIN}/playbooks/country/italy` },
        { "@type": "ListItem", position: 3, name: "Rome", item: `${ORIGIN}/playbooks/country/italy/city/rome` },
        { "@type": "ListItem", position: 4, name: "Food", item: `${ORIGIN}/playbooks/country/italy/city/rome/tag/meal` },
      ],
    });
  });
});

describe("placeItemListJsonLd", () => {
  it("lists the place's days in order, each by its name at its absolute canonical URL", () => {
    const days = [
      { savedDayId: "11111111-1111-4111-8111-111111111111", name: "A slow day" },
      { savedDayId: "22222222-2222-4222-8222-222222222222", name: "Temples & tea" },
    ];
    expect(placeItemListJsonLd(days, ORIGIN)).toEqual({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          url: `${ORIGIN}/playbooks/day/a-slow-day-11111111-1111-4111-8111-111111111111`,
          name: "A slow day",
        },
        {
          "@type": "ListItem",
          position: 2,
          url: `${ORIGIN}/playbooks/day/temples-tea-22222222-2222-4222-8222-222222222222`,
          name: "Temples & tea",
        },
      ],
    });
  });
});

describe("serializeJsonLd", () => {
  it("cannot close the script element it is written into", () => {
    const out = serializeJsonLd({ "@context": "https://schema.org", "@type": "Thing", name: "</script><script>alert(1)" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)");
  });

  it("cannot open an HTML comment inside the script element either", () => {
    // `<!--` inside a script switches the HTML parser into its escaped state, where a later `</script>` is misread.
    const out = serializeJsonLd({ "@context": "https://schema.org", "@type": "Thing", name: "a <!-- b" });
    expect(out).not.toContain("<!--");
    expect(JSON.parse(out).name).toBe("a <!-- b");
  });
});
