import { describe, expect, it } from "vitest";
import { PLAYBOOKS_GENERIC, playbookCityCopy, playbookDayCopy, playbookProfileCopy } from "./copy";

// The words on the Playbooks cards (spec 2026-10-02 §2.7). Which card a link
// gets is `og.int.test.ts`; this is what each one says.

const day = {
  kind: "day" as const,
  name: "Temples before the crowds",
  cities: ["Kyoto"],
  dayCount: 3,
  stopCount: 12,
  author: "Traveler a1b2c3",
  rating: 4.62,
  reviewCount: 12,
};

describe("playbookDayCopy", () => {
  it("titles the day with its name, over where, how long, whose and how rated", () => {
    expect(playbookDayCopy(day)).toEqual({
      label: "Caesura · playbook",
      title: "Temples before the crowds",
      description: "Kyoto · 3 days · 12 stops · by Traveler a1b2c3 · ★ 4.6 (12)",
    });
  });

  it("says nothing of length for one day, of place without a city, or of a rating nobody gave", () => {
    const plain = { ...day, cities: [], dayCount: 1, stopCount: 1, rating: null, reviewCount: 0 };

    expect(playbookDayCopy(plain).description).toBe("1 stop · by Traveler a1b2c3");
  });

  it("names every city it was given", () => {
    expect(playbookDayCopy({ ...day, cities: ["Kyoto", "Nara"] }).description).toMatch(/^Kyoto, Nara · /);
  });

  it("falls back to the Playbooks card", () => {
    expect(playbookDayCopy({ kind: "generic" })).toEqual(PLAYBOOKS_GENERIC);
  });
});

describe("playbookProfileCopy", () => {
  it("titles the profile with the handle, over its numbers and the cities it knows", () => {
    const card = { kind: "profile" as const, author: "Traveler a1b2c3", playbooksShared: 4, adds: 9, cities: ["Kyoto", "Osaka"] };

    expect(playbookProfileCopy(card)).toEqual({
      label: "Caesura · playbooks",
      title: "Traveler a1b2c3's playbooks",
      description: "4 playbooks · added to 9 trips · knows Kyoto, Osaka",
    });
  });

  it("counts one in the singular, and leaves out adds and cities it does not have", () => {
    const card = { kind: "profile" as const, author: "Traveler a1b2c3", playbooksShared: 1, adds: 0, cities: [] };

    expect(playbookProfileCopy(card).description).toBe("1 playbook");
    expect(playbookProfileCopy({ ...card, adds: 1 }).description).toBe("1 playbook · added to 1 trip");
  });

  it("falls back to the Playbooks card", () => {
    expect(playbookProfileCopy({ kind: "generic" })).toEqual(PLAYBOOKS_GENERIC);
  });
});

describe("playbookCityCopy", () => {
  it("titles one city's Discover with the city and how many days are there", () => {
    expect(playbookCityCopy({ kind: "city", city: "Kyoto", days: 7 })).toEqual({
      label: "Caesura · playbooks",
      title: "Kyoto playbooks",
      description: "7 days other travelers planned in Kyoto",
    });
    expect(playbookCityCopy({ kind: "city", city: "Kyoto", days: 1 }).description).toBe(
      "1 day a traveler planned in Kyoto",
    );
  });

  it("falls back to the Playbooks card", () => {
    expect(playbookCityCopy({ kind: "generic" })).toEqual({
      label: "Caesura · playbooks",
      title: "Playbooks on Caesura",
      description: "Days other people planned and rated. Find one for your city and drop it into your trip.",
    });
  });
});
