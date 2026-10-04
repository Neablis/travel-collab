// Who is going to each stop, as `participants` (M13 link 5) — and the six stops
// where that deliberately narrows the export's `who: "all"`.
//
// Why it matters (ADR-060): a stop's price is per person, and a stop nobody is
// picked for is priced for every member. With all four travellers on every
// stop, `/demo` totalled 36,340 against a budget the export set for prices
// summed once. Reading the export's own `who` into `participants` is the
// honest half of the fix, and it saves little, because the export names people
// only on seven cheap rows. The rest is these picks plus a raised budget
// (`JAPAN_TRIP_BUDGET_USD`).
//
// The picks follow the pairs the export already draws: Priya and Mei take the
// Hakone Open-Air Museum and lunch at Monk, Sam and Jonah the Osaka and Kyoto
// late nights (Kichi Kichi, Shinsekai, Yaekatsu), and Mei goes off alone to
// Itoya. Each pick's `why` below says the rest. Nothing here moves a
// price, a time or a `who` — those stay upstream's, and `upstreamDrift.test.ts`
// still compares them verbatim. Hotels and transit are left to everyone,
// because everyone sleeps and travels.

import { JAPAN_TRAVELLERS, type JapanBacklogItem, type JapanStop, type JapanTraveller } from "./trip.ts";

export const PARTICIPANT_PICKS: Record<string, { going: JapanTraveller[]; why: string }> = {
  "d6-s2-hakone-open-air-museum": {
    going: ["Priya", "Mei"],
    why: "The museum pair's morning; Sam and Jonah take the ropeway and meet them for lunch.",
  },
  "d9-s5-dinner-at-kichi-kichi": {
    going: ["Sam", "Jonah"],
    why: "An eight-seat counter booked two seats at a time; the late-night pair got the slot.",
  },
  "d10-s2-lunch-at-monk": {
    going: ["Priya", "Mei"],
    why: "A dozen seats, booked by the seat, after the Philosopher's Path walk the two of them planned.",
  },
  "d12-s4-shinsekai-and-tsutenkaku": {
    going: ["Sam", "Jonah"],
    why: "The afternoon before the kushikatsu, while Priya and Mei are still at Nakanoshima.",
  },
  "d12-s5-kushikatsu-at-yaekatsu": {
    going: ["Sam", "Jonah"],
    why: "Jonah's food night after the Dōtonbori crawl he picked; the other two have an early ferry.",
  },
  "d5-s4-itoya-and-ginza-six": {
    going: ["Mei"],
    why: "Stationery is Mei's errand, the same solo streak as the pottery class in Kyoto.",
  },
};

/** The export names a traveller "Sam K"; the roster, and so a member id, is "Sam". */
function travellerNamed(exportName: string): JapanTraveller {
  const first = exportName.split(" ")[0];
  const found = JAPAN_TRAVELLERS.find((t) => t === first);
  if (found === undefined) throw new Error(`who names "${exportName}", who is not one of the trip's travellers`);
  return found;
}

/**
 * Who is going to `row`: its pick, or the export's own `who`, or nobody picked
 * (which means everyone, ADR-060 decision 2). A pick only ever narrows "all":
 * one on a row the export already names people for would overrule the export,
 * which is the drift this package refuses, so it throws.
 */
export function participantsOf(row: JapanStop | JapanBacklogItem): JapanTraveller[] {
  const pick = PARTICIPANT_PICKS[row.id];
  if (pick !== undefined && row.who !== "all") throw new Error(`${row.id}: a pick overrules the export's who`);
  if (pick !== undefined) return pick.going;
  return row.who === "all" ? [] : row.who.map(travellerNamed);
}
