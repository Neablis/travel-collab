// Stops whose `city` deliberately disagrees with the design export's
// `days[].city`, and why.
//
// The export (.design-sync/handoff/data/japan-trip-seed.json) has no per-stop
// city at all — it models city as a property of the DAY, and a day is tagged
// with the city it ARRIVES in. `./trip.ts` denormalises `days[].city` onto
// every stop, so on a travel day that convention put the destination's name on
// a stop the traveller had not reached yet. The seven rows below are where
// that produced a statement about geography that is simply false: "Zentis
// Osaka, Kita, Tokyo" for a hotel in Osaka, "Shinjuku Station, Shinjuku,
// Hakone" for a station in Tokyo.
//
// This was KI-59, filed 2026-08-28 and carried as a recorded design decision
// until 2026-08-30 (Mitchell: "Go ahead and fix, i want honesty, not keeping
// past data the same"). Two things had to land first, and both have:
//
//   - `cityFor()` (DayChips.tsx) now names a day from its LAST located
//     activity, not its first (M18). Every row below is its day's first or
//     second stop and every one of these days still ENDS in the city the
//     export named, so correcting them no longer retags whole days — which is
//     exactly the regression the 2026-08-29 attempt measured and reverted.
//   - `detectConflicts`'s `transitExcusesDistance` (KI-60) stopped flagging a
//     relocation the day's own shinkansen accounts for, so a travel day that
//     honestly spans two cities does not light up as "same day, ~400km apart".
//
// The values are facts about geography, not judgement calls, and each entry
// says which fact so a reader can check it against a map rather than trust it.
// `upstreamDrift.test.ts` compares every other field verbatim and fails on any
// divergence not listed here, and it also asserts that each entry below is
// real, is actually applied, and still changes something — so a stale entry
// cannot quietly widen the guard one stop at a time.
//
// Six of the seven are `transit`; the seventh (`d14-s1`) is breakfast at the
// hotel, and it is the clearest evidence that this was never a question about
// how to model travel. A day's city and a stop's city are different facts.
//
// What this does NOT claim: a transit stop still carries ONE city, the one it
// departs from. The domain has no origin/destination pair on an activity (that
// is a contract change and its own reviewed step), so "Shinkansen to Tokyo"
// tagged Osaka says where the traveller boards, which is where the stop's
// `lat`/`lng` have always been. `d13-s5-ferry-and-train-back-to-osaka` needs no
// entry here for the same reason: it departs Miyanoura Port ON Naoshima, so
// its day's city and its departure city already agree.
//
// Two of the corrected cities — Odawara and Tamano — are not cities the trip
// stays in. They are where the traveller physically stands at 09:30 and 07:00
// on those mornings, so they are what the row says. This is why the fixture's
// city list is eight rather than six (`expectations.ts`).
export const CITY_OVERRIDES: Record<string, { upstream: string; ours: string; why: string }> = {
  "d4-s1-limited-express-to-nikko": {
    upstream: "Nikkō",
    ours: "Tokyo",
    why: "Tobu Asakusa Station is in Asakusa, Taitō, Tokyo — the platform the Nikkō train leaves from, ~113km short of Nikkō. Day 4 is a day trip out of Tokyo and back; only its middle three stops are in Nikkō.",
  },
  "d6-s1-romancecar-to-hakone-yumoto": {
    upstream: "Hakone",
    ours: "Tokyo",
    why: "Shinjuku Station is in Shinjuku, Tokyo. The Romancecar reaches Hakone-Yumoto 95 minutes later; the boarding is ~74km from Hakone.",
  },
  "d7-s1-shinkansen-odawara-kyoto": {
    upstream: "Kyoto",
    ours: "Odawara",
    why: "Odawara Station is in Odawara, Kanagawa — its own city, ~10km down the valley from where day 6 ended in Hakone and ~310km from Kyoto. Neither the day's destination nor the previous day's city is where this stop stands, so it names the place it actually is.",
  },
  "d11-s1-train-kyoto-osaka": {
    upstream: "Osaka",
    ours: "Kyoto",
    why: "Kyoto Station is in Shimogyō, Kyoto — the stop that ENDS the trip's four-day Kyoto stretch rather than opening the Osaka one, ~40km away.",
  },
  "d13-s1-train-and-ferry-to-naoshima": {
    upstream: "Naoshima",
    ours: "Tamano",
    why: "Uno Port is in Tamano, Okayama, on the mainland — the ferry terminal Naoshima is reached FROM, ~5km of water short of the island.",
  },
  "d14-s1-breakfast-at-the-hotel": {
    upstream: "Tokyo",
    ours: "Osaka",
    why: "Zentis Osaka is in Kita, Osaka — the hotel checked into on day 11, eaten in at 08:00, ~400km from Tokyo. Not a transit stop at all: it inherited the destination purely because the day it sits on ends in Tokyo.",
  },
  "d14-s2-shinkansen-to-tokyo": {
    upstream: "Tokyo",
    ours: "Osaka",
    why: "Shin-Osaka Station is in Yodogawa, Osaka. The shinkansen arrives in Tokyo at 11:45; the stop is where it is boarded, ~402km away.",
  },
};
