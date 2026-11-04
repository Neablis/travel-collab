import { describe, expect, it } from "vitest";
import { judgeMatch, nameQueryOf, nameVerdictOf } from "./placeAcceptance";

const verdict = (name: string, candidate: string) => nameVerdictOf(nameQueryOf({ name }), candidate);

// Which comma segment of a stop's name names its venue is not knowable from the
// string, so each is tried (review of PR 686, finding 3). The rows are the
// shapes that the first-segment-only rule got wrong, and the ones it must keep.
describe("nameVerdictOf", () => {
  it("finds the venue in any segment, not only the first", () => {
    expect(verdict("Dinner, Ria's Wines", "Ria's Wines, Main Street, Penn Yan, New York, USA")).toBe("match");
    expect(verdict("Rome, Trevi Fountain", "Trevi Fountain, Piazza di Trevi, Rome, Italy")).toBe("match");
  });

  // A segment that is only the answer's own geography is where the answer is,
  // not what it is called. Tried as a name, "Rome" would accept anything in Rome.
  it("does not let the answer's own town stand in for the venue", () => {
    expect(verdict("Rome, Trevi Fountain", "Pantheon, Piazza della Rotonda, Rome, Italy")).toBe("mismatch");
    expect(verdict("Kegon Falls, Chūzenji, Nikkō", "Urami Falls, Nikkō, Tochigi Prefecture, Japan")).toBe("mismatch");
    expect(verdict("Penn Yan", "Liquor Outlet, Main Street, Penn Yan, New York, USA")).toBe("mismatch");
    // The dangerous half: an answer whose own name contains the town. Tried as
    // a venue, "Rome" covers "Rome Cavalieri" and "Nikkō" covers "Nikko Station".
    expect(verdict("Rome, Trevi Fountain", "Rome Cavalieri, Via Alberto Cadlolo, Rome, Italy")).toBe("mismatch");
    expect(verdict("Kegon Falls, Nikkō", "Nikkō Station, Matsubara-chō, Nikkō, Tochigi Prefecture, Japan")).toBe("mismatch");
  });

  it("leaves a street address to the geometry instead of refusing it", () => {
    expect(verdict("123 Main St, Springfield", "123, Main Street, Springfield, Illinois, USA")).toBe("not-comparable");
    expect(verdict("1-2-3 Nishi-Azabu", "1-2-3, Nishi-Azabu, Minato, Tokyo, Japan")).toBe("not-comparable");
    // A bare number is a name, not an address: a bar called "1905".
    expect(verdict("1905", "1906, Rue Saint-Merri, Paris, France")).toBe("mismatch");
  });

  it("keeps the KI-39 refusals and acceptances it was built on", () => {
    expect(verdict("Kegon Falls, Chūzenji, Nikkō", "Kegon Falls, Chūzenji, Nikkō, Tochigi Prefecture, Japan")).toBe("match");
    expect(verdict("Ria's Wines", "Ria's Wine Bar, Main Street, Penn Yan, New York, USA")).toBe("mismatch");
    expect(verdict("Meiji Shrine", "明治神宮, Shibuya, Tokyo, Japan")).toBe("not-comparable");
  });
});

describe("judgeMatch", () => {
  const box = { minLat: 42, maxLat: 43.5, minLng: -79.5, maxLng: -76.5 };
  const atlanta = { lat: 33.749, lng: -84.388, canonicalName: "Ria's Wines, Atlanta, Georgia, USA" };

  it("refuses the right name in the wrong place, and accepts it with nothing to check against", () => {
    expect(judgeMatch(nameQueryOf({ name: "Ria's Wines" }), atlanta, { hint: null, region: box })).toBe("wrong-place");
    expect(judgeMatch(nameQueryOf({ name: "Ria's Wines" }), atlanta, { hint: null, region: null })).toBe("unchecked");
  });

  it("refuses a wrong name even with nothing to check its position against", () => {
    const shop = { ...atlanta, canonicalName: "Liquor Outlet, Atlanta, Georgia, USA" };
    expect(judgeMatch(nameQueryOf({ name: "Ria's Wines" }), shop, { hint: null, region: null })).toBe("wrong-name");
  });
});
