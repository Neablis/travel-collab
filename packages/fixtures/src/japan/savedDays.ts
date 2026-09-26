// The demo library: saved days for TWO people, from the Japan trip (M11b).
//
// This file exists because `savedDays` appeared in no fixture at all, and
// `db:seed` created none — so M11b's exit-gate box, *"a profile's day count and
// adds agree with the same person's numbers in Discover, checked against a seed
// where they could disagree"*, had nothing to check against, and `AGENTS.md`'s
// Definition of Done ("a new contract field is exercised by the demo fixture")
// had nowhere to land. M18's tag chips shipped against a preview whose data had
// zero tags; this is the same failure, caught before rather than after.
//
// --- Two owners, and every number distinguishable ---
// One owner would make the agreement check vacuous: a Discover query and a
// profile would trivially agree if there were only ever one person's days to
// disagree about. So there are two, and no two numbers that a bug could swap
// are equal WHERE A SWAP IS POSSIBLE. Two properties, both asserted in
// `verify.test.ts` rather than only stated here: no field is equal across the
// two owners (days 3 vs 2, published 2 vs 1, adds 5 vs 4), and within one owner
// no two of the three are equal. The second is the one the profile header needs
// — it renders "days shared" and "added to trips" together, so alice's days 3 /
// adds 3 was a swap that still added up. The one pair deliberately left equal
// is alice's published (2) and bob's days (2): no surface renders those two
// together, so no swap between them is reachable.
// If any pair of those becomes equal, the seed stops being able to catch the
// bug it exists to catch.
//
// --- What is deliberately NOT here ---
// `cities` is DERIVED, never authored. The whole point of link 1 is that one
// rule (`citiesOfStops`) decides a day's cities; a hand-written `cities: [...]`
// beside these stops would be a second source of truth and would agree only
// until someone edited a stop. `verify.ts` folds the real rule over these stops
// and `expectations.ts` states the answer, which is what makes a change to
// either the stops or the rule show up as a finding.
//
// `adds` is derived too — it is the LENGTH of `addedBy` below. The counter is
// denormalised from the ledger in the database for the same reason, and the
// fixture would be lying about the shape if it carried the two independently.
//
// --- Why some stops carry a cost ---
// M11b's shared-day rail states the day's total cost and Discover filters on
// it, both derived by `savedDayFacts` from the priced stops. A fixture where every stop
// is unpriced would make that fact "—" in every demo and every screenshot, and
// the budget filter a control with nothing to act on — which is M18's tag-chip
// failure, the one AGENTS.md's Definition of Done names by name. So the three
// PUBLISHED days carry prices (`verify.ts` fails the seed if one does not) and
// the two private ones deliberately do not: a day that does not say what it
// costs is the ordinary case, and something has to render it.

import type { SavedStop } from "@tc/contracts";
import { JAPAN_TRIP_CURRENCY, JAPAN_TRIP_NAME } from "./trip.ts";

/** One row of the adds ledger: a trip somebody took this day into. */
export type JapanSavedDayAdd = {
  /** `saved_day_adds.trip_id`. Distinct per add — the ledger is keyed on it. */
  tripId: string;
  /** `saved_day_adds.added_by`. Never the day's own owner: see below. */
  addedBy: string;
};

/**
 * One saved day, as the seed declares it.
 *
 * Not a `SavedDay`: that carries `cities` and `adds`, which are derived, and a
 * `createdAt` the seeder decides. This is the authored part.
 */
export type JapanSavedDay = {
  savedDayId: string;
  ownerId: string;
  name: string;
  /** The author's one paragraph (ADR-050, Pass A). Absent = none, as most days have. */
  summary?: string;
  stops: SavedStop[];
  visibility: "private" | "public";
  /** The ledger rows for this day. `adds` is this list's length, never a separate number. */
  addedBy: JapanSavedDayAdd[];
};

// The trip these were lifted out of. A fixed id rather than the seeded trip's:
// `source_trip_id`/`source_trip_name` are a SNAPSHOT (ADR-028, ADR-029) and the
// credit is meant to survive the source being renamed or deleted, so a saved
// day pointing at a trip that is not in the database is a state the product
// must handle, not one the fixture should avoid.
const SOURCE_TRIP_ID = "00000000-0000-4000-8000-00000000f000";

const ALICE = "dev-alice";
const BOB = "dev-bob";

/**
 * A price, in the trip's own currency.
 *
 * `JAPAN_TRIP_CURRENCY` rather than a literal per stop: ADR-008 makes currency
 * trip-level, and `savedDayFacts` refuses to sum a day whose priced stops
 * disagree about it — a fixture that spelled the code out five times would be
 * the one place that disagreement could be introduced by a typo.
 */
function money(amountMinor: number): SavedStop["cost"] {
  return { amountMinor, currency: JAPAN_TRIP_CURRENCY };
}

/**
 * A stop, with its place.
 *
 * **`lat`/`lng` are optional and almost every stop here has none**, which is
 * the seed telling the truth rather than an omission: a saved day whose stops
 * were never geocoded is the ordinary state of this table, and §16's
 * degrade-to-list-only exists for it.
 *
 * What is NOT acceptable is the state this file was in until 2026-09-20 —
 * **no stop anywhere carrying a coordinate**, so `SharedDayMap` could not draw
 * on any seeded database and the map half of §16 had never been seen by
 * anybody. Walking the preview found three Discover days rendering zero
 * canvases; the cause was here, not in the component.
 *
 * **Every coordinate below is lifted from `coordinates.json`** — this repo's
 * own geocode of the Japan trip, already reviewed against its `canonicalName`.
 * None is typed from memory. That is a rule, not a preference: KI-39 is the
 * entry that cost this seed a pin in the wrong country, and a hand-authored
 * coordinate is permanent (`geocode-content.py`'s `--apply` skips any stop that
 * already has a `lat`). If a stop's place is not in that file, it gets no
 * coordinate here — see `KI-2026-09-20-d` for the rest of the library.
 */
function stop(
  title: string,
  start: string,
  end: string,
  place: { name: string; city?: string; lat?: number; lng?: number } | null,
  extras: Partial<SavedStop> = {},
): SavedStop {
  return {
    title,
    timeWindow: { start, end },
    location:
      place === null
        ? null
        : { name: place.name, city: place.city, lat: place.lat, lng: place.lng },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    // One-day seeds: a saved day is a sequence of length one (M23, ADR-048).
    // `extras` can still override it for a multi-day fixture.
    dayIndex: 0,
    mode: null,
    endLocation: null,
    pendingReason: null,
    ...extras,
  };
}

export const JAPAN_SOURCE_TRIP = { id: SOURCE_TRIP_ID, name: JAPAN_TRIP_NAME };

export const JAPAN_SAVED_DAYS: JapanSavedDay[] = [
  {
    savedDayId: "aa000000-0000-4000-8000-000000000001",
    ownerId: ALICE,
    name: "Kyoto temples on foot",
    summary: "Four temples south to east on foot, starting at Fushimi Inari before the gates fill and ending at Kiyomizu-dera as the lanterns come on.",
    visibility: "public",
    // Two different people, two different trips. Two rows, so `adds` is 2 —
    // and if a future write path counted raw inserts instead, this is the day
    // whose number would move.
    addedBy: [
      { tripId: "bb000000-0000-4000-8000-000000000001", addedBy: BOB },
      { tripId: "bb000000-0000-4000-8000-000000000002", addedBy: "dev-carol" },
    ],
    stops: [
      // Under the Discover filter's lower band edge ($50 for the day) once summed —
      // the cheap end of the three ranges has to have an occupant in the demo
      // or the band is a control nobody can see work.
      // `coordinates.json`, `d8-s1-fushimi-inari-at-dawn` — canonicalName
      // "Fushimi Inari-taisha, Fushimi Ward, Kyoto, Kyoto Prefecture, Japan".
      stop("Fushimi Inari at opening", "07:30", "09:30", { name: "Fushimi Inari Taisha", city: "Kyoto", lat: 34.9675192, lng: 135.7797101 }, {
        cost: money(0),
      }),
      stop("Tofuku-ji gardens", "10:15", "11:30", { name: "Tofuku-ji", city: "Kyoto" }, {
        cost: money(500),
      }),
      stop("Lunch at Omen Kodaiji", "12:30", "13:30", { name: "Omen Kodaiji", city: "Kyoto" }, {
        cost: money(1_800),
      }),
      // Same city as the first stop and not adjacent to it — the day reports
      // Kyoto ONCE, which is what makes `cities.length` "how many cities does
      // this day touch" rather than "how many stops are placed".
      // `coordinates.json`, `d8-s3-kiyomizu-dera-and-sannenzaka`. **The second
      // located stop on this day, and that is the point** — `worthDrawing`
      // needs two, so this is the one seeded Playbook whose map DRAWS. The two
      // middle stops stay unlocated, so it also draws the gapped leg
      // `sharedDayGeometry` has always had a code path for and never a seed.
      stop("Kiyomizu-dera at dusk", "17:00", "18:30", { name: "Kiyomizu-dera", city: "Kyoto", lat: 34.994303, lng: 135.7844389 }, {
        cost: money(400),
      }),
    ],
  },
  {
    savedDayId: "aa000000-0000-4000-8000-000000000002",
    ownerId: ALICE,
    name: "Tokyo to Hakone, slowly",
    summary: "A travel day that does not feel like one: coffee in Nakameguro, the Romancecar out, and an onsen before dinner.",
    visibility: "public",
    // Three rows, not one. Alice's total has to differ from her own DAY count
    // as well as from Bob's total: the profile header renders "days shared" and
    // "added to trips" side by side, so days 3 / adds 3 was a pair a bug could
    // swap and still add up. Raised by review on pull request 102.
    addedBy: [
      { tripId: "bb000000-0000-4000-8000-000000000003", addedBy: BOB },
      { tripId: "bb000000-0000-4000-8000-000000000006", addedBy: BOB },
      { tripId: "bb000000-0000-4000-8000-000000000007", addedBy: "dev-carol" },
    ],
    // A travel day, and the reason this fixture is not six single-city days:
    // Discover's per-card line ("Kyoto matched · also Uji") and its sibling
    // chips have nothing to render unless some day touches more than one city.
    stops: [
      // Over the upper band edge ($150 for the day): a travel day costs more than a
      // walking day, and the top band needs an occupant for the same reason the
      // bottom one does.
      stop("Breakfast in Nakameguro", "08:00", "09:00", { name: "Onibus Coffee", city: "Tokyo" }, {
        cost: money(1_200),
      }),
      stop("Romancecar to Hakone-Yumoto", "10:30", "12:00", { name: "Shinjuku Station", city: "Tokyo" }, {
        cost: money(2_400),
      }),
      stop("Open-Air Museum", "13:30", "16:00", { name: "Hakone Open-Air Museum", city: "Hakone" }, {
        cost: money(1_600),
      }),
      stop("Onsen before dinner", "17:00", "18:30", { name: "Tenzan Tohji-kyo", city: "Hakone" }, {
        cost: money(11_000),
      }),
    ],
  },
  {
    savedDayId: "aa000000-0000-4000-8000-000000000003",
    ownerId: ALICE,
    name: "Nakameguro, unhurried",
    // Private, and never added by anyone — the default state, and what a
    // publish/unpublish walk needs on the other side of the button.
    visibility: "private",
    addedBy: [],
    stops: [
      stop("Coffee on the canal", "09:30", "10:30", { name: "Sidewalk Stand", city: "Tokyo" }),
      // No location at all: the plain "not placed yet" case.
      stop("Wander", "10:30", "12:00", null),
      stop("Soba at Yotaro", "12:30", "13:30", { name: "Yotaro", city: "Tokyo" }),
    ],
  },
  {
    savedDayId: "aa000000-0000-4000-8000-000000000004",
    ownerId: BOB,
    name: "Kyoto, then an evening in Osaka",
    visibility: "public",
    // Four, deliberately more than any of Alice's: the leaderboard has to be
    // able to rank these two people, and a tie would prove nothing.
    addedBy: [
      { tripId: "bb000000-0000-4000-8000-000000000004", addedBy: ALICE },
      { tripId: "bb000000-0000-4000-8000-000000000005", addedBy: ALICE },
      { tripId: "bb000000-0000-4000-8000-000000000006", addedBy: "dev-carol" },
      { tripId: "bb000000-0000-4000-8000-000000000007", addedBy: "dev-dan" },
    ],
    stops: [
      // The middle band. The Shinkansen stop below stays UNPRICED on purpose:
      // a day with some priced stops and some not is the ordinary case, and
      // the rail's Budget figure has to be readable as a FLOOR — it sums the
      // stops that carry a price and says nothing about the ones that do not,
      // which is what `unpricedStops` sits beside it to admit.
      // `coordinates.json`, `d8-s5-nishiki-market`. **The ONLY located stop on
      // this day, deliberately left that way**: one coordinate is fewer than
      // `worthDrawing`'s two, so this day is §16's degrade-to-list-only — the
      // other half of M26's shared-day gate box, and it is beside the day that
      // draws on the same Discover page rather than in a test fixture.
      stop("Nishiki Market", "10:00", "11:30", { name: "Nishiki Market", city: "Kyoto", lat: 35.0050244, lng: 135.7655699 }, {
        cost: money(2_500),
      }),
      // A location with NO city — `Location.city` is `.optional()`, so a
      // manually typed place carries none (KI-35's shape). The rule skips it
      // rather than falling back to the name, which would answer "which city"
      // with "Shinkansen platform".
      stop("Shinkansen east", "15:40", "16:15", { name: "Shinkansen platform" }),
      stop("Kushikatsu in Shinsekai", "18:30", "20:00", { name: "Daruma Shinsekai", city: "Osaka" }, {
        cost: money(3_200),
      }),
    ],
  },
  {
    savedDayId: "aa000000-0000-4000-8000-000000000005",
    ownerId: BOB,
    name: "Naoshima in one day",
    summary: "The first ferry, Chichu before the timed slots run out, and the Benesse walk in the afternoon light.",
    visibility: "private",
    addedBy: [],
    stops: [
      stop("Ferry from Uno", "08:20", "09:00", { name: "Uno Port", city: "Naoshima" }),
      stop("Chichu Art Museum", "10:00", "12:30", { name: "Chichu Art Museum", city: "Naoshima" }),
      stop("Benesse House walk", "14:00", "16:00", { name: "Benesse House", city: "Naoshima" }),
    ],
  },
];
