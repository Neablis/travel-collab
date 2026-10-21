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
  it("drops one dimension for parents and adds one where a day matches for children", () => {
    const nav = latticeNav({ country: ITALY, city: ROME, tag: "meal" }, lattice);
    expect(nav.parents.map((link) => link.href)).toEqual([
      "/playbooks/country/italy/city/rome",
      "/playbooks/country/italy/meal",
      "/playbooks/city/rome/meal",
    ]);
    expect(nav.children).toEqual([]);
  });

  it("refines a country×city by its tags, and a country by its tags then its cities", () => {
    const pair = latticeNav({ country: ITALY, city: ROME }, lattice);
    expect(pair.parents.map((link) => link.href)).toEqual(["/playbooks/country/italy", "/playbooks/city/rome"]);
    expect(pair.children.map((link) => link.href)).toEqual([
      "/playbooks/country/italy/city/rome/meal",
      "/playbooks/country/italy/city/rome/museum",
    ]);

    const country = latticeNav({ country: ITALY }, lattice);
    expect(country.parents).toEqual([]);
    expect(country.children.map((link) => link.href)).toEqual([
      "/playbooks/country/italy/city/rome",
      "/playbooks/country/italy/meal",
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
    expect(nav.children[0]?.href).toBe("/playbooks/country/country-0/meal");
  });
});
