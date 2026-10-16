// Gate 1's labeled dataset: 25 real plan queries with hand-labeled relevant
// day-chunks, for the plan-retrieval RAG stack's offline recall eval (Part 3).
//
// **What the labels are.** Each label is a `(sourceType, sourceName, dayIndex)`
// tuple. `sourceName` is the human-readable playbook name (`saved_days.name`)
// or trip name — NOT a database id. The eval resolves names to ids at runtime
// against the database it's pointed at (fixture-seeded throwaway, or
// production Neon in `RECALL_EVAL_PRODUCTION=1` mode), and FAILS LOUD if a
// name doesn't resolve to exactly one row. This keeps the dataset portable:
// the same labels run against fixtures and against Mitchell's real corpus.
//
// **These labels are the dataset author's judgments.** They were written
// against the REAL checked-in corpus: the 19 content bundles under
// `content/playbooks/` (every playbook is one public day) and the 14-day
// Japan fixture trip (`@tc/fixtures`' `japanTripCommands`). A label means "a
// planner answering this query would genuinely consult this day" — NOT "this
// day is in the same destination". Where the corpus has no exact destination
// match (e.g. no Hawaii, no Iceland playbooks exist), the labeled days are the
// closest genuinely useful analogues (a Thai beach-honeymoon day for a Hawaii
// honeymoon query; Tromsø's aurora chase for a northern-lights query), and the
// query text says so in its intent comment. Every playbook label's name was
// verified against its bundle file, and every Japan label's day verified
// against `packages/fixtures/src/japan/trip.ts`.
//
// The free `planRetrieval.recall.dataset.test.ts` (CI) re-derives every
// label's name from the checked-in content and asserts it matches a real
// playbook — so a renamed playbook fails loudly rather than silently zeroing
// recall.

/** Which corpus a labeled chunk belongs to. */
export type RecallLabelSourceType = "playbook" | "trip";

/** A hand-labeled relevant chunk, as `(sourceType, sourceName, dayIndex)`. */
export interface RecallLabel {
  sourceType: RecallLabelSourceType;
  /**
   * Human-readable name: `saved_days.name` for playbooks, the trip name for
   * trips. Resolved to a database id at eval runtime (fail loud if the name
   * is missing or ambiguous in the target database).
   */
  sourceName: string;
  /** 0-based (ADR-048): a bundle playbook's only day is 0; Japan day N is N-1. */
  dayIndex: number;
}

/** One labeled query. */
export interface RecallQuery {
  /** Stable id, `q-01` … `q-25`. */
  id: string;
  /** The plan query text, embedded and retrieved verbatim by the eval. */
  query: string;
  /** 1–3 hand-labeled relevant chunks. */
  labels: RecallLabel[];
}

/** The Japan fixture trip's display name, as seeded by the eval. */
export const JAPAN_TRIP_NAME = "Japan (recall eval)";

/**
 * The Japan fixture trip's id in the eval database. Fixed (not random) so the
 * fixture-mode seed is deterministic; production mode resolves by name.
 */
export const JAPAN_TRIP_ID = "7d9f3b2a-1c4e-4a5f-9b6d-2e8f0a1b3c4d";

/** A label on a playbook day, by the playbook's human-readable name. */
function playbook(name: string): RecallLabel {
  // Bundle playbooks are one-day playbooks: dayIndex is always 0.
  return { sourceType: "playbook", sourceName: name, dayIndex: 0 };
}

/** A label on the Japan trip's day `n` (1-based, as the fixture numbers it). */
function japanDay(n: number): RecallLabel {
  return { sourceType: "trip", sourceName: JAPAN_TRIP_NAME, dayIndex: n - 1 };
}

export const RECALL_DATASET: RecallQuery[] = [
  {
    id: "q-01",
    query: "plan a 6-day food trip to Tokyo",
    labels: [
      japanDay(2), // teamLab + Tsukiji Outer Market lunch + yakitori at Torishiki
      japanDay(3), // Meiji Jingū + ramen at Afuri + dinner at Den
      japanDay(5), // Nezu Museum + Kagari lunch + omakase at Sushi Yoshitake
    ],
  },
  {
    id: "q-02",
    query: "3 days in Paris focused on museums",
    labels: [
      playbook("The Louvre and the Orsay done properly — the one weekday both allow"),
      playbook("Versailles at nine, then the half of it the buses never reach"),
    ],
  },
  {
    id: "q-03",
    query: "beach honeymoon in Hawaii, somewhere romantic and quiet",
    // No Hawaii content in the corpus: the Thai beach days are the genuinely
    // useful analogues (private charters, sunset spots, slow-beach pacing).
    labels: [
      playbook("Railay: the first longtail, Phra Nang before the crowd, and back after dark"),
      playbook("Samui at full tilt: a private boat to Ang Thong and dinner on the rocks"),
    ],
  },
  {
    id: "q-04",
    query: "long weekend hiking in the Alps, big views, no car",
    labels: [
      playbook("Grindelwald First to Schynige Platte: Bachalpsee, the Faulhorn and six hours of ridge"),
      playbook("Innsbruck: twenty minutes from the old town to 2334 m, then the Goetheweg"),
      playbook("Zermatt: the 07:00 Gornergrat train, then the Five Lakes down to Sunnegga"),
    ],
  },
  {
    id: "q-05",
    query: "wine tasting weekend near San Francisco",
    labels: [
      playbook("Napa done properly: Schramsberg caves, Frog's Leap, Stag's Leap — and somebody else driving"),
      playbook("The Russian River instead: two great pinots, a picnic, and half the money"),
    ],
  },
  {
    id: "q-06",
    query: "2 days in Rome, first visit, the classics done right",
    labels: [playbook("Rome: the Forum at opening, Testaccio at lunch, Trastevere after dark")],
  },
  {
    id: "q-07",
    query: "ski week in the Dolomites, staying in one valley",
    labels: [
      playbook("The Sellaronda green, counter-clockwise, with the lunch booked before you leave"),
      playbook("SunRisa: lifts at 07:15, breakfast at 2,079 m, Gran Risa before the crowd"),
      playbook("Cortina with an instructor: Ra Valles at opening, Cinque Torri for lunch"),
    ],
  },
  {
    id: "q-08",
    query: "slow family beach week in Thailand with a 5-year-old, no boats if possible",
    labels: [
      playbook("Koh Lanta at half speed: one scooter, three beaches, no boat"), // "no boat" day
      playbook("Koh Yao Noi by bicycle: rice paddies, the Laem Haad sandbar, dinner over the fields"),
    ],
  },
  {
    id: "q-09",
    query: "4 days in Kyoto: temples, gardens and tea",
    labels: [
      japanDay(8), // Fushimi Inari + Kiyomizu-dera + Sannenzaka
      japanDay(9), // Arashiyama + Tenryū-ji + tea at Ippodo
      japanDay(10), // Ginkaku-ji + Philosopher's Path + pottery
    ],
  },
  {
    id: "q-10",
    query: "street food crawl in Mexico City",
    labels: [
      playbook("Mexico City: chinampas at nine, Roma and Condesa from three until late"),
      playbook("Oaxaca on foot: cacao at seven, the smoke hall at one, mezcal until late"), // markets + smoke hall, the street-food craft
    ],
  },
  {
    id: "q-11",
    query: "chasing the northern lights, best aurora viewing trip",
    // No Iceland content in the corpus: Tromsø's polar-night aurora chase and
    // Snæfellsnes-under-aurora are the genuinely useful analogues.
    labels: [
      playbook("Tromsø in the polar night: huskies at noon, aurora chase at midnight"),
      playbook("Snæfellsnes in one loop, ending under the aurora at Kirkjufell"),
    ],
  },
  {
    id: "q-12",
    query: "day trip to Versailles from Paris, beat the crowds",
    labels: [playbook("Versailles at nine, then the half of it the buses never reach")],
  },
  {
    id: "q-13",
    query: "Machu Picchu in one day from Cusco",
    labels: [playbook("Machu Picchu done properly: the 04:20 queue and Huayna Picchu")],
  },
  {
    id: "q-14",
    query: "Santorini honeymoon, 3 days, caldera views",
    labels: [
      playbook("Santorini: Fira to Oia on foot, and the sunset nobody queues for"),
      playbook("Santorini: a boat of your own down the caldera, and the table at the edge"),
    ],
  },
  {
    id: "q-15",
    query: "3 days in Seoul eating everything in sight",
    labels: [
      playbook("Seoul: Gwangjang at eleven, a jjimjilbang at noon, a three-star counter at eight"), // Gwangjang market at eleven
      playbook("Seoul: hanbok at the gate, two palaces, and Euljiro on plastic stools"),
    ],
  },
  {
    id: "q-16",
    query: "Utah and Arizona national parks road trip, the big ones",
    labels: [
      playbook("Zion in one enormous day: the chains at 08:00, the Narrows by afternoon"),
      playbook("Grand Canyon, the whole budget: rim sunrise, Bright Angel, and 45 minutes in the air"),
      playbook("Moab double: Mesa Arch at sunrise, Delicate Arch in the afternoon"),
    ],
  },
  {
    id: "q-17",
    query: "2 days in Marrakech, medina and food",
    labels: [playbook("Marrakech: the medina done slowly, ending on a rooftop at the adhan")],
  },
  {
    id: "q-18",
    query: "one perfect food day in Osaka",
    labels: [
      japanDay(11), // Harukoma sushi + Dōtonbori food crawl
      japanDay(12), // Kuromon Market + kushikatsu at Yaekatsu
    ],
  },
  {
    id: "q-19",
    query: "art museums in Tokyo, contemporary and classic",
    labels: [
      japanDay(2), // teamLab Planets
      japanDay(5), // Nezu Museum
      japanDay(6), // Hakone Open-Air Museum
    ],
  },
  {
    id: "q-20",
    query: "quiet onsen ryokan night near Tokyo",
    labels: [japanDay(6)], // Gora Kadan check-in + kaiseki dinner
  },
  {
    id: "q-21",
    query: "London in a day: markets in the morning, a museum after",
    labels: [
      playbook("A Sunday on Columbia Road, then down Brick Lane"),
      playbook("The Wallace, a matinee, and a tasting menu on the Strand"),
    ],
  },
  {
    id: "q-22",
    query: "Bali: temples at dawn and beach clubs after",
    labels: [
      playbook("Ubud at dawn: Tegallalang before the buses, purification at Tirta Empul"),
      playbook("Uluwatu: Padang Padang at low tide, kecak on the cliff, Jimbaran on the sand"),
    ],
  },
  {
    id: "q-23",
    query: "Istanbul in 2 days, old city and the Bosphorus",
    labels: [
      playbook("Sultanahmet in the order nobody does it, and a Sinan hammam at the end"),
      playbook("The Bosphorus on the public boat, and Kadıköy at dinner time"),
    ],
  },
  {
    id: "q-24",
    query: "Finger Lakes wine weekend in the fall",
    labels: [
      playbook("Keuka: Dr. Frank first, then the whole bluff by car"),
      playbook("Harvest weekend on Seneca: a barrel tasting, a schooner and the chef's table"),
    ],
  },
  {
    id: "q-25",
    query: "5 days in Vietnam: Hanoi, Ha Long Bay, Hoi An",
    labels: [
      playbook("Hanoi Old Quarter: bun cha at noon, bia hoi at dusk"),
      playbook("Lan Ha Bay by private charter: suite cabin, Dark and Bright Cave, chef's table"), // Lan Ha Bay, Ha Long's quieter neighbour
      playbook("Hoi An: a tailor's first fitting, An Bang at four, lanterns after dark"),
    ],
  },
];
