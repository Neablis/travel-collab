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
