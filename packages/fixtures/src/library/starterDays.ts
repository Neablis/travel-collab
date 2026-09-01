// The starter library: good, ready-to-take days a fresh database has in it
// from the first `pnpm --filter web db:reseed`.
//
// Mitchell, 2026-09-01: *"We should seed a few really good day trips for people
// to use from a new DB state to test with."* The demo library that existed
// (`../japan/savedDays.ts`) is five Japan days built to a different brief — it
// exists so M11b's exit gate has *"a seed where two people's numbers could
// disagree"*, and every count in it is load-bearing (`verify.ts`,
// `expectations.ts`, and two invariants asserted in `verify.test.ts`: no field
// equal across the two owners, and no two of one owner's own three equal).
//
// **So this is a second, additive file rather than five more entries there.**
// Adding days to `JAPAN_SAVED_DAYS` would have meant re-deriving those numbers
// and re-checking both invariants for a change whose entire purpose is
// "somebody signing up should find something worth taking" — and any future
// addition here would mean doing it again. Nothing in the verification harness
// reads this file, and nothing here may be relied on by a gate; it is content.
//
// --- What makes a day here "good" ---
// Every one of them is publishable on its own terms, which is a real
// constraint rather than a slogan:
//
//   * **Priced.** `savedDayFacts` derives "budget each" from the priced stops,
//     and Discover's budget band filters on it — a day with nothing priced
//     shows "—" and is invisible to that control. The days below span the
//     BOTTOM two bands on purpose (see `BUDGET_BAND_EDGES`: under $50 and
//     $50-$150), so that filter has an occupant on both. None of them plausibly
//     clears the upper edge ($150 each) on its own terms — every stop here is a
//     ticket, a meal or a fare, and pricing one up into that band would mean
//     inventing a stop that does not belong on the day rather than pricing the
//     day honestly (CodeRabbit, PR #104: two of these comments used to claim
//     "top band" for days that priced out at $72 and $92 — corrected below,
//     not inflated to match). The library already has an upper-band occupant
//     elsewhere: `../japan/savedDays.ts`'s "Tokyo to Hakone, slowly" ($162
//     each, a travel day with an onsen), which is a real day where that price
//     is the honest one. The filter having an occupant everywhere does not
//     require every file to supply one.
//   * **Placed.** Every stop carries a `city`, so `citiesOfStops` gives the day
//     real cities to be found by. Two of them touch more than one city, which
//     is what the per-card "Kyoto matched · also Uji" line and the sibling
//     chips render from.
//   * **Timed, and in order.** The stops are chronological with honest gaps —
//     `stopsForDay` keeps order and gaps and drops the date (ADR-029), so a day
//     that reads oddly here reads oddly in every trip it is taken into.
//   * **Seasonal.** `keptOn` spreads them across all four seasons, because
//     Discover's season filter buckets from exactly that timestamp (`Season` in
//     apps/web/src/lib/playbooks.ts). Seeded with `new Date()` for every row —
//     which is what the demo library does — every day would land in one bucket
//     and three quarters of that control would return nothing.
//
// --- Owners ---
// Three people, none of them the person running the seed. A library where you
// wrote everything in it is not a library, and "Everyone" being a superset of
// "Yours" (2026-09-01) only means something when the two differ.

import type { SavedStop } from "@tc/contracts";
import type { JapanSavedDay } from "../japan/savedDays.ts";

/**
 * A seeded saved day, plus the one thing the demo library did not need: when it
 * was kept.
 *
 * `keptOn` becomes `saved_days.created_at`, which is the month Discover's
 * season filter and the shared-day rail both read. Optional, so
 * `JAPAN_SAVED_DAYS` (which does not carry one) still satisfies this type and
 * the seed route can hand both lists to the same writer.
 */
export type SeededSavedDay = JapanSavedDay & { keptOn?: string };

/** The trip each of these was lifted out of — a snapshot, never a row. */
const SOURCE_TRIPS = {
  portugal: { id: "00000000-0000-4000-8000-00000000f101", name: "Portugal: Lisbon → Sintra → Porto" },
  mexico: { id: "00000000-0000-4000-8000-00000000f102", name: "Mexico City, a long weekend" },
  scotland: { id: "00000000-0000-4000-8000-00000000f103", name: "Highlands loop" },
  newYork: { id: "00000000-0000-4000-8000-00000000f104", name: "New York in the cold" },
} as const;

const CARLOS = "dev-carlos";
const PRIYA = "dev-priya";
const MAEVE = "dev-maeve";

/**
 * USD everywhere, matching the demo trip.
 *
 * ADR-008 makes currency trip-level and `savedDayFacts` refuses to sum a day
 * whose priced stops disagree — but more importantly, Discover's
 * `budgetCurrency` is the ONE currency every matched day agrees on, and it
 * hides the budget control entirely when a result set is mixed. Seeding a euro
 * day beside the Japan library's dollars would take that control off the page
 * for every unfiltered browse, which is a worse demo than a slightly
 * unrealistic one.
 */
const CURRENCY = "USD";

function money(amountMinor: number): SavedStop["cost"] {
  return { amountMinor, currency: CURRENCY };
}

function stop(
  title: string,
  start: string,
  end: string,
  place: { name: string; city: string },
  extras: Partial<SavedStop> = {},
): SavedStop {
  return {
    title,
    timeWindow: { start, end },
    location: { name: place.name, city: place.city },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    ...extras,
  };
}

export const STARTER_SAVED_DAYS: SeededSavedDay[] = [
  {
    savedDayId: "ac000000-0000-4000-8000-000000000001",
    ownerId: CARLOS,
    name: "Lisbon: Alfama downhill, all day",
    visibility: "public",
    // Spring, and the cheap band — a walking day with two small tickets and
    // lunch. Somebody taking this is taking a route, not a budget.
    keptOn: "2026-04-12T09:00:00.000Z",
    addedBy: [
      { tripId: "bc000000-0000-4000-8000-000000000001", addedBy: PRIYA },
      { tripId: "bc000000-0000-4000-8000-000000000002", addedBy: MAEVE },
      { tripId: "bc000000-0000-4000-8000-000000000003", addedBy: "dev-alice" },
    ],
    stops: [
      stop("Tram 28 up to Graça", "09:00", "09:40", { name: "Praça Martim Moniz", city: "Lisbon" }, {
        kind: "transit",
        cost: money(350),
      }),
      stop("Miradouro da Senhora do Monte", "09:45", "10:15", { name: "Miradouro da Senhora do Monte", city: "Lisbon" }, {
        tags: ["outdoors"],
        notes: "Go here before the Graça terrace — same view, a fraction of the people.",
      }),
      stop("São Vicente de Fora cloisters", "10:30", "11:45", { name: "Mosteiro de São Vicente de Fora", city: "Lisbon" }, {
        tags: ["ticketed"],
        cost: money(850),
      }),
      stop("Lunch at Ti-Natércia", "12:30", "13:45", { name: "Ti-Natércia", city: "Lisbon" }, {
        tags: ["meal"],
        notes: "Twelve tables, cash only, no reservations. Arrive at opening or eat at three.",
        cost: money(1_800),
      }),
      stop("Down through Alfama to the river", "14:00", "16:00", { name: "Campo das Cebolas", city: "Lisbon" }, {
        tags: ["outdoors"],
        notes: "No route worth writing down — the whole point is losing the plan for two hours.",
      }),
      stop("Ginjinha at Sol e Pesca", "16:30", "17:15", { name: "Sol e Pesca", city: "Lisbon" }, {
        cost: money(600),
      }),
    ],
  },
  {
    savedDayId: "ac000000-0000-4000-8000-000000000002",
    ownerId: CARLOS,
    name: "Sintra without the queue",
    visibility: "public",
    // Spring as well, and the middle band: two palaces and a train fare add up
    // to $72 each — priced (CodeRabbit, PR #104), not "top band" as this
    // comment used to claim; see the file header for where the top band's
    // real occupant lives. The most-added day in the starter set — it is the
    // one with real advice in it, which is what a Playbook is for.
    keptOn: "2026-05-03T09:00:00.000Z",
    addedBy: [
      { tripId: "bc000000-0000-4000-8000-000000000004", addedBy: PRIYA },
      { tripId: "bc000000-0000-4000-8000-000000000005", addedBy: MAEVE },
      { tripId: "bc000000-0000-4000-8000-000000000006", addedBy: "dev-alice" },
      { tripId: "bc000000-0000-4000-8000-000000000007", addedBy: "dev-bob" },
    ],
    // Two cities: the day starts in Lisbon and spends itself in Sintra, which
    // is what gives Discover's sibling chips and the "also in" line something
    // to render in the starter set as well as the Japan one.
    stops: [
      stop("Early train from Rossio", "07:40", "08:25", { name: "Rossio Station", city: "Lisbon" }, {
        kind: "transit",
        notes: "The 07:41 is the whole trick. Anything after nine and Pena is a two-hour queue.",
        cost: money(500),
      }),
      stop("Pena Palace at opening", "09:00", "11:00", { name: "Palácio Nacional da Pena", city: "Sintra" }, {
        kind: "booked",
        tags: ["ticketed"],
        notes: "Timed entry, booked online. The park ticket alone is not enough for the interior.",
        cost: money(2_200),
      }),
      stop("Walk down to Quinta da Regaleira", "11:15", "12:00", { name: "Estrada da Pena", city: "Sintra" }, {
        tags: ["outdoors"],
      }),
      stop("Quinta da Regaleira and the initiation well", "12:00", "14:00", { name: "Quinta da Regaleira", city: "Sintra" }, {
        tags: ["ticketed"],
        cost: money(1_400),
      }),
      stop("Late lunch at Tascantiga", "14:15", "15:30", { name: "Tascantiga", city: "Sintra" }, {
        tags: ["meal"],
        cost: money(2_600),
      }),
      stop("Train back", "16:30", "17:15", { name: "Sintra Station", city: "Sintra" }, {
        kind: "transit",
        cost: money(500),
      }),
    ],
  },
  {
    savedDayId: "ac000000-0000-4000-8000-000000000003",
    ownerId: PRIYA,
    name: "Mexico City: Coyoacán, slowly",
    visibility: "public",
    // Summer. The cheap band — the priced stops total $36 each, not "middle
    // band" as this comment used to claim (CodeRabbit, PR #104 review; the
    // same pass that caught the two "top band" mislabels below fixed this
    // one too, for the same reason: read the total off the stops rather than
    // trust the label). A day with one booked ticket and everything else
    // improvised — the ordinary shape of a good day.
    keptOn: "2026-07-19T09:00:00.000Z",
    addedBy: [
      { tripId: "bc000000-0000-4000-8000-000000000008", addedBy: CARLOS },
      { tripId: "bc000000-0000-4000-8000-000000000009", addedBy: "dev-bob" },
    ],
    stops: [
      stop("Breakfast at Mercado de Coyoacán", "09:30", "10:30", { name: "Mercado de Coyoacán", city: "Mexico City" }, {
        tags: ["meal"],
        notes: "Tostadas at the counter at the back. Two is plenty; three is a mistake you make once.",
        cost: money(900),
      }),
      stop("Museo Frida Kahlo", "11:00", "12:30", { name: "Museo Frida Kahlo", city: "Mexico City" }, {
        kind: "booked",
        tags: ["ticketed"],
        notes: "Sells out days ahead. Buy the timed slot before you leave home, not that morning.",
        cost: money(1_600),
      }),
      stop("Jardín Centenario, doing nothing", "12:45", "14:00", { name: "Jardín Centenario", city: "Mexico City" }, {
        tags: ["outdoors"],
      }),
      stop("Museo Casa de León Trotsky", "14:30", "15:45", { name: "Museo Casa de León Trotsky", city: "Mexico City" }, {
        tags: ["ticketed"],
        cost: money(700),
      }),
      stop("Churros at El Jarocho", "16:00", "16:30", { name: "Café El Jarocho", city: "Mexico City" }, {
        tags: ["meal"],
        cost: money(400),
      }),
    ],
  },
  {
    savedDayId: "ac000000-0000-4000-8000-000000000004",
    ownerId: PRIYA,
    name: "Glen Coe on foot, then a fire",
    visibility: "public",
    // Autumn, and the cheap band — the whole day costs a car park and a meal.
    // Also the only day in the set with a weather note, which is the kind of
    // thing a saved day is genuinely better at carrying than a trip is.
    // 2025, not 2026 (CodeRabbit, PR #104): `keptOn` seeds `created_at` /
    // `published_at` and the ledger, so a future date shows a day "created"
    // ahead of today (2026-09-01) and sorts it above every real one — the
    // same defect the New York day below had, and worth the same fix: the
    // equivalent date one year in the past, so the month stays autumn.
    keptOn: "2025-10-08T09:00:00.000Z",
    addedBy: [{ tripId: "bc000000-0000-4000-8000-000000000010", addedBy: MAEVE }],
    stops: [
      stop("Park at the Three Sisters", "08:30", "08:45", { name: "Three Sisters Viewpoint", city: "Glencoe" }, {
        cost: money(400),
      }),
      stop("Up the Lost Valley", "09:00", "12:30", { name: "Coire Gabhail", city: "Glencoe" }, {
        tags: ["outdoors"],
        notes: "Boots, not trainers — the river crossing is real. Turn back at the boulder field if it is wet.",
      }),
      stop("Soup at the Clachaig", "13:00", "14:15", { name: "Clachaig Inn", city: "Glencoe" }, {
        tags: ["meal"],
        cost: money(1_900),
      }),
      stop("Loch Achtriochtan in the flat light", "14:45", "15:30", { name: "Loch Achtriochtan", city: "Glencoe" }, {
        tags: ["outdoors"],
      }),
    ],
  },
  {
    savedDayId: "ac000000-0000-4000-8000-000000000005",
    ownerId: MAEVE,
    name: "New York: uptown museums in the cold",
    visibility: "public",
    // Winter — the fourth season bucket, without which a quarter of the filter
    // returns nothing. Middle band: two museum admissions and a proper lunch
    // total $92 each, not "top band" as this comment used to claim
    // (CodeRabbit, PR #104) — see the file header for where the real top-band
    // occupant lives.
    //
    // 2026, not 2027 (CodeRabbit, PR #104): `keptOn` seeds `created_at` /
    // `published_at` and the ledger, and today is 2026-09-01 — a saved day
    // "created" in the future sorts above every real one in the library and
    // is the most visible version of this bug (it's the freshest-looking
    // thing in a fresh database). Moved back one year so the month stays
    // winter.
    keptOn: "2026-01-24T09:00:00.000Z",
    addedBy: [
      { tripId: "bc000000-0000-4000-8000-000000000011", addedBy: CARLOS },
      { tripId: "bc000000-0000-4000-8000-000000000012", addedBy: "dev-alice" },
    ],
    stops: [
      stop("The Met, Egyptian wing first", "10:00", "12:30", { name: "The Metropolitan Museum of Art", city: "New York" }, {
        tags: ["ticketed"],
        notes: "Start at the far end and work back — everybody else starts at the entrance.",
        cost: money(3_000),
      }),
      stop("Lunch at Jacob's Pickles", "13:00", "14:15", { name: "Jacob's Pickles", city: "New York" }, {
        tags: ["meal"],
        cost: money(3_400),
      }),
      stop("Cross the park at 79th", "14:30", "15:00", { name: "Central Park, 79th Street Transverse", city: "New York" }, {
        tags: ["outdoors"],
      }),
      stop("American Museum of Natural History", "15:15", "17:30", { name: "American Museum of Natural History", city: "New York" }, {
        tags: ["ticketed"],
        cost: money(2_800),
      }),
    ],
  },
  {
    savedDayId: "ac000000-0000-4000-8000-000000000006",
    ownerId: MAEVE,
    name: "Porto: bridge, cellar, sunset",
    visibility: "private",
    // Private and never added — the default state, and what the publish button
    // on the shared-day screen needs on the other side of it in a fresh
    // database. Deliberately unpriced too: a day that does not say what it
    // costs is the ordinary case and something has to render it.
    // 2025, not 2026 (CodeRabbit, PR #104): same future-`keptOn` defect as the
    // Glen Coe and New York days above — moved back one year, past today
    // (2026-09-01).
    keptOn: "2025-09-27T09:00:00.000Z",
    addedBy: [],
    stops: [
      stop("Across the top deck of the Dom Luís I", "16:00", "16:30", { name: "Ponte Luís I", city: "Porto" }, {
        tags: ["outdoors"],
      }),
      stop("Cellar tour in Gaia", "17:00", "18:00", { name: "Taylor's Port", city: "Vila Nova de Gaia" }, {
        tags: ["ticketed"],
      }),
      stop("Sunset from the Jardim do Morro", "18:30", "19:15", { name: "Jardim do Morro", city: "Vila Nova de Gaia" }, {
        tags: ["outdoors"],
      }),
    ],
  },
];

/** Which snapshot trip each starter day claims as its source. */
export const STARTER_SOURCE_TRIP: Record<string, { id: string; name: string }> = {
  "ac000000-0000-4000-8000-000000000001": SOURCE_TRIPS.portugal,
  "ac000000-0000-4000-8000-000000000002": SOURCE_TRIPS.portugal,
  "ac000000-0000-4000-8000-000000000003": SOURCE_TRIPS.mexico,
  "ac000000-0000-4000-8000-000000000004": SOURCE_TRIPS.scotland,
  "ac000000-0000-4000-8000-000000000005": SOURCE_TRIPS.newYork,
  "ac000000-0000-4000-8000-000000000006": SOURCE_TRIPS.portugal,
};
