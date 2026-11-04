import { describe, expect, it } from "vitest";
import { latticeNav, type LatticeData } from "./latticeNav";

// The lattice data is synthetic: what matters is the shape of the navigation
// — parents by dropping a dimension, children by adding one where a day
// matches — not the database behind it.
const lattice: LatticeData = {
  tags: [
    { tag: "meal", city: null, country: null, days: 9 },
    { tag: "meal", city: null, country: { slug: "italy", name: "Italy" }, days: 5 },
    { tag: "meal", city: { slug: "rome", name: "Rome" }, country: null, days: 4 },
    { tag: "meal", city: { slug: "rome", name: "Rome" }, country: { slug: "italy", name: "Italy" }, days: 3 },
    { tag: "museum", city: { slug: "rome", name: "Rome" }, country: { slug: "italy", name: "Italy" }, days: 2 },
    { tag: "meal", city: { slug: "milan", name: "Milan" }, country: { slug: "italy", name: "Italy" }, days: 1 },
  ],
  countryCities: [
    { country: { slug: "italy", name: "Italy" }, city: { slug: "rome", name: "Rome" }, days: 6 },
    { country: { slug: "italy", name: "Italy" }, city: { slug: "milan", name: "Milan" }, days: 1 },
    // Rome is also a city in the United States: the city page must link down
    // to both country×city pages, not just to its tags.
    { country: { slug: "united-states", name: "United States" }, city: { slug: "rome", name: "Rome" }, days: 2 },
  ],
};

const ITALY = { slug: "italy", name: "Italy", countries: ["IT"] };
const ROME = { slug: "rome", name: "Rome", cities: ["Rome"] };

describe("latticeNav", () => {
  it("labels every link with its target page's own heading, not the old 'playbooks' pattern", () => {
    const nav = latticeNav({ country: ITALY, city: ROME, tag: "meal" }, lattice);
    expect(nav.parents.map((link) => link.label)).toEqual([
      "Rome, Italy: trips from real travelers",
      "Food days in Italy",
      "Food days in Rome",
    ]);
    // A city's refinements are its country×city pages (Rome exists in two
    // countries here); a pair's are its tags; a tag's are its scoped pages.
    // A pair's parents are its country and city pages' own headings.
    const pairParents = latticeNav({ country: ITALY, city: ROME }, lattice);
    expect(pairParents.parents.map((link) => link.label)).toEqual([
      "Italy trips from real travelers",
      "Rome trips from real travelers",
    ]);
    const city = latticeNav({ city: ROME }, lattice);
    expect(city.children.map((link) => link.label)).toContain("Rome, Italy: trips from real travelers");
    expect(city.children.map((link) => link.label)).toContain("Rome, United States: trips from real travelers");
    const pair = latticeNav({ country: ITALY, city: ROME }, lattice);
    expect(pair.children.map((link) => link.label)).toEqual([
      "Food days in Rome, Italy",
      "Museum days in Rome, Italy",
    ]);
    const tag = latticeNav({ tag: "meal" }, lattice);
    expect(tag.children.map((link) => link.label)).toContain("Food days in Italy");
  });

  it("drops one dimension for parents and adds one where a day matches for children", () => {
    const nav = latticeNav({ country: ITALY, city: ROME, tag: "meal" }, lattice);
    expect(nav.parents.map((link) => link.href)).toEqual([
      "/playbooks/country/italy/city/rome",
      "/playbooks/country/italy/tag/meal",
      "/playbooks/city/rome/meal",
    ]);
    expect(nav.children).toEqual([]);
  });

  it("refines a country×city by its tags, and a country by its tags then its cities", () => {
    const pair = latticeNav({ country: ITALY, city: ROME }, lattice);
    expect(pair.parents.map((link) => link.href)).toEqual(["/playbooks/country/italy", "/playbooks/city/rome"]);
    expect(pair.children.map((link) => link.href)).toEqual([
      "/playbooks/country/italy/city/rome/tag/meal",
      "/playbooks/country/italy/city/rome/tag/museum",
    ]);

    const country = latticeNav({ country: ITALY }, lattice);
    expect(country.parents).toEqual([]);
    expect(country.children.map((link) => link.href)).toEqual([
      "/playbooks/country/italy/city/rome",
      "/playbooks/country/italy/tag/meal",
      "/playbooks/country/italy/city/milan",
    ]);
  });

  it("refines a city by its tags and by the countries it sits in", () => {
    const nav = latticeNav({ city: ROME }, lattice);
    expect(nav.parents).toEqual([]);
    expect(nav.children.map((link) => link.href)).toEqual([
      "/playbooks/country/italy/city/rome",
      "/playbooks/city/rome/meal",
      "/playbooks/country/united-states/city/rome",
    ]);
  });
  it("orders tied country×city refinements by country slug, not input order", () => {
    // Same city, same days, input listed United States first: without a
    // country tiebreak the output would keep that input order, which no
    // ORDER BY pins down — the order must be the page's, not the reader's.
    const tied: LatticeData = {
      tags: [],
      countryCities: [
        { country: { slug: "united-states", name: "United States" }, city: { slug: "cambridge", name: "Cambridge" }, days: 5 },
        { country: { slug: "united-kingdom", name: "United Kingdom" }, city: { slug: "cambridge", name: "Cambridge" }, days: 5 },
      ],
    };
    const nav = latticeNav({ city: { slug: "cambridge", name: "Cambridge", cities: ["Cambridge"] } }, tied);
    expect(nav.children.map((link) => link.href)).toEqual([
      "/playbooks/country/united-kingdom/city/cambridge",
      "/playbooks/country/united-states/city/cambridge",
    ]);
  });
  it("caps refinements at twelve, most days first", () => {
    const many: LatticeData = {
      tags: Array.from({ length: 15 }, (_, i) => ({
        tag: "meal",
        city: null,
        country: { slug: `country-${i}`, name: `Country ${i}` },
        days: 15 - i,
      })),
      countryCities: [],
    };
    // A global tag page's refinements are its countries' tag pages.
    const nav = latticeNav({ tag: "meal" }, many);
    expect(nav.children).toHaveLength(12);
    expect(nav.children[0]?.href).toBe("/playbooks/country/country-0/tag/meal");
  });

  describe("length pages", () => {
    const withLengths: LatticeData = {
      ...lattice,
      lengths: [
        { band: "one", city: null, country: null, days: 20 },
        { band: "two-three", city: null, country: null, days: 7 },
        { band: "one", city: null, country: { slug: "italy", name: "Italy" }, days: 8 },
        { band: "one", city: { slug: "rome", name: "Rome" }, country: null, days: 5 },
        { band: "one", city: { slug: "rome", name: "Rome" }, country: { slug: "italy", name: "Italy" }, days: 4 },
        { band: "one", city: { slug: "rome", name: "Rome" }, country: { slug: "united-states", name: "United States" }, days: 1 },
        { band: "two-three", city: { slug: "milan", name: "Milan" }, country: { slug: "italy", name: "Italy" }, days: 2 },
      ],
    };

    it("climbs a country×city length page to its place, and to the band one place wider each way", () => {
      const nav = latticeNav({ country: ITALY, city: ROME, length: "one" }, withLengths);
      expect(nav.parents).toEqual([
        { label: "Rome, Italy: trips from real travelers", href: "/playbooks/country/italy/city/rome" },
        { label: "1-day trips in Italy", href: "/playbooks/country/italy/length/1-day" },
        { label: "1-day trips in Rome", href: "/playbooks/city/rome/length/1-day" },
      ]);
      expect(nav.children).toEqual([]);
    });

    it("refines a country's band into its cities, a city's into its countries, and the library's into both", () => {
      expect(latticeNav({ country: ITALY, length: "one" }, withLengths)).toEqual({
        parents: [
          { label: "Italy trips from real travelers", href: "/playbooks/country/italy" },
          { label: "1-day trips from real travelers", href: "/playbooks/length/1-day" },
        ],
        children: [{ label: "1-day trips in Rome, Italy", href: "/playbooks/country/italy/city/rome/length/1-day" }],
      });
      expect(latticeNav({ city: ROME, length: "one" }, withLengths).children.map((link) => link.href)).toEqual([
        "/playbooks/country/italy/city/rome/length/1-day",
        "/playbooks/country/united-states/city/rome/length/1-day",
      ]);
      expect(latticeNav({ length: "one" }, withLengths)).toEqual({
        parents: [],
        children: [
          { label: "1-day trips in Italy", href: "/playbooks/country/italy/length/1-day" },
          { label: "1-day trips in Rome", href: "/playbooks/city/rome/length/1-day" },
        ],
      });
    });

    it("links a place page down to its own bands, and no other place's", () => {
      const country = latticeNav({ country: ITALY }, withLengths).children.map((link) => link.href);
      expect(country).toContain("/playbooks/country/italy/length/1-day");
      expect(country.filter((href) => href.includes("/length/"))).toEqual(["/playbooks/country/italy/length/1-day"]);
      const city = latticeNav({ city: ROME }, withLengths).children.map((link) => link.href);
      expect(city.filter((href) => href.includes("/length/"))).toEqual(["/playbooks/city/rome/length/1-day"]);
      const pair = latticeNav({ country: ITALY, city: ROME }, withLengths).children.map((link) => link.href);
      expect(pair.filter((href) => href.includes("/length/"))).toEqual(["/playbooks/country/italy/city/rome/length/1-day"]);
    });

    it("leaves a tag page's links alone", () => {
      expect(latticeNav({ tag: "meal" }, withLengths)).toEqual(latticeNav({ tag: "meal" }, lattice));
    });
  });
});
