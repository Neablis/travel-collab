import { describe, expect, it } from "vitest";
import { dayDescription } from "./playbooksPreview";
import { dayJsonLd, organizationJsonLd, serializeJsonLd, webSiteJsonLd } from "./jsonLd";

const ORIGIN = "https://caesura.today";
const DAY = {
  origin: ORIGIN,
  path: "/playbooks/day/a-slow-day-abc",
  name: "A slow day",
  description: "Temples, then the river.",
  author: "Dana R.",
  stops: ["Kiyomizu-dera", "Nishiki Market"],
  rating: null,
  reviewCount: 0,
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

  it("says nothing about a rating nobody gave", () => {
    expect(dayJsonLd(DAY)[0]).not.toHaveProperty("aggregateRating");
  });

  it("carries the rating once there are reviews", () => {
    const [trip] = dayJsonLd({ ...DAY, rating: 4.6, reviewCount: 12 });
    expect(trip).toMatchObject({
      aggregateRating: { "@type": "AggregateRating", ratingValue: 4.6, reviewCount: 12, bestRating: 5, worstRating: 1 },
    });
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

describe("serializeJsonLd", () => {
  it("cannot close the script element it is written into", () => {
    const out = serializeJsonLd({ "@context": "https://schema.org", "@type": "Thing", name: "</script><script>alert(1)" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)");
  });
});
