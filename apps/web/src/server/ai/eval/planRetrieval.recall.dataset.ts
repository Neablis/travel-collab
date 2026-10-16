// Gate 1's labeled dataset: 25 real plan queries with hand-labeled relevant
// day-chunks, for the plan-retrieval RAG stack's offline recall eval (Part 3).
//
// **What the labels are.** Each label is a `(sourceType, sourceId, dayIndex)`
// tuple — the same triple the retrieval rows carry (`DayChunk`), and NOT a
// `day_embeddings.id`, which is minted at embed time and unknowable to an
// author. The eval resolves labels at runtime by matching those three fields
// against what `retrieveDayChunks` returned.
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
// query text says so in its intent comment. Every playbook label's key was
// verified to exist in its bundle file, and every Japan label's day verified
// against `packages/fixtures/src/japan/trip.ts`.
//
// The free `planRetrieval.recall.dataset.test.ts` (CI) re-derives every
// label's sourceId from the checked-in content and asserts it resolves to a
// real row with a valid dayIndex — so a renamed bundle key or a drifted
// fixture fails loudly rather than silently zeroing recall.

import { playbookIdFor } from "@tc/fixtures";

/** Which corpus a labeled chunk belongs to. */
export type RecallLabelSourceType = "playbook" | "trip";

/** A hand-labeled relevant chunk, as `(sourceType, sourceId, dayIndex)`. */
export interface RecallLabel {
  sourceType: RecallLabelSourceType;
  /** The `saved_days` id for playbooks, the trip id for trips. */
  sourceId: string;
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

/**
 * The Japan fixture trip's id in the eval database. Fixed (not random) so the
 * dataset can name its days; the eval seeds the trip under exactly this id.
 */
export const JAPAN_TRIP_ID = "7d9f3b2a-1c4e-4a5f-9b6d-2e8f0a1b3c4d";

/** A label on a bundle playbook day (`dayIndex` is always 0: one-day playbooks). */
function playbook(bundleKey: string, playbookKey: string): RecallLabel {
  return { sourceType: "playbook", sourceId: playbookIdFor(bundleKey, playbookKey), dayIndex: 0 };
}

/** A label on the Japan trip's day `n` (1-based, as the fixture numbers it). */
function japanDay(n: number): RecallLabel {
  return { sourceType: "trip", sourceId: JAPAN_TRIP_ID, dayIndex: n - 1 };
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
      playbook("france-cities", "louvre-and-orsay-the-thursday-that-works"),
      playbook("france-cities", "versailles-nine-oclock-and-the-trianon-afternoon"),
    ],
  },
  {
    id: "q-03",
    query: "beach honeymoon in Hawaii, somewhere romantic and quiet",
    // No Hawaii content in the corpus: the Thai beach days are the genuinely
    // useful analogues (private charters, sunset spots, slow-beach pacing).
    labels: [
      playbook("thailand-beaches", "railay-limestone-and-sunset"),
      playbook("thailand-beaches", "samui-private-charter-and-dining-on-the-rocks"),
    ],
  },
  {
    id: "q-04",
    query: "long weekend hiking in the Alps, big views, no car",
    labels: [
      playbook("alpine-summer", "grindelwald-first-faulhorn-schynige-platte"),
      playbook("alpine-summer", "innsbruck-nordkette-goetheweg"),
      playbook("alpine-summer", "zermatt-gornergrat-and-five-lakes"),
    ],
  },
  {
    id: "q-05",
    query: "wine tasting weekend near San Francisco",
    labels: [
      playbook("california-coast-and-wine", "napa-three-tastings-and-a-driver"),
      playbook("california-coast-and-wine", "russian-river-the-cheaper-better-wine-day"),
    ],
  },
  {
    id: "q-06",
    query: "2 days in Rome, first visit, the classics done right",
    labels: [playbook("italy-cities", "rome-forum-at-opening-testaccio-lunch-trastevere-late")],
  },
  {
    id: "q-07",
    query: "ski week in the Dolomites, staying in one valley",
    labels: [
      playbook("italy-skiing", "sellaronda-green-counter-clockwise"),
      playbook("italy-skiing", "alta-badia-sunrisa-and-gran-risa"),
      playbook("italy-skiing", "cortina-ra-valles-and-cinque-torri"),
    ],
  },
  {
    id: "q-08",
    query: "slow family beach week in Thailand with a 5-year-old, no boats if possible",
    labels: [
      playbook("thailand-beaches", "koh-lanta-slow-beach-day"), // "no boat" day
      playbook("thailand-beaches", "koh-yao-noi-bicycle-and-sandbar"),
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
      playbook("mexico-central-america", "xochimilco-morning-then-roma-and-condesa"),
      playbook("mexico-central-america", "oaxaca-markets-mole-and-mezcal"), // markets + smoke hall, the street-food craft
    ],
  },
  {
    id: "q-11",
    query: "chasing the northern lights, best aurora viewing trip",
    // No Iceland content in the corpus: Tromsø's polar-night aurora chase and
    // Snæfellsnes-under-aurora are the genuinely useful analogues.
    labels: [
      playbook("nordic-landscapes", "tromso-polar-night-huskies-and-aurora"),
      playbook("nordic-landscapes", "snaefellsnes-loop-and-aurora-at-kirkjufell"),
    ],
  },
  {
    id: "q-12",
    query: "day trip to Versailles from Paris, beat the crowds",
    labels: [playbook("france-cities", "versailles-nine-oclock-and-the-trianon-afternoon")],
  },
  {
    id: "q-13",
    query: "Machu Picchu in one day from Cusco",
    labels: [playbook("andes-patagonia", "machu-picchu-first-bus-huayna-picchu")],
  },
  {
    id: "q-14",
    query: "Santorini honeymoon, 3 days, caldera views",
    labels: [
      playbook("greek-islands", "santorini-caldera-walk-and-skaros-sunset"),
      playbook("greek-islands", "santorini-private-caldera-charter"),
    ],
  },
  {
    id: "q-15",
    query: "3 days in Seoul eating everything in sight",
    labels: [
      playbook("korea-taiwan-hongkong", "seoul-gwangjang-jjimjilbang-chefs-counter"), // Gwangjang market at eleven
      playbook("korea-taiwan-hongkong", "seoul-hanbok-palaces-to-euljiro"),
    ],
  },
  {
    id: "q-16",
    query: "Utah and Arizona national parks road trip, the big ones",
    labels: [
      playbook("us-national-parks", "zion-angels-landing-and-the-narrows"),
      playbook("us-national-parks", "grand-canyon-rim-sunrise-bright-angel-and-a-flight"),
      playbook("us-national-parks", "mesa-arch-sunrise-delicate-arch-sunset"),
    ],
  },
  {
    id: "q-17",
    query: "2 days in Marrakech, medina and food",
    labels: [playbook("medinas-and-deserts", "marrakech-medina-and-the-adhan-rooftop")],
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
      playbook("britain-ireland", "columbia-road-sunday-and-brick-lane"),
      playbook("britain-ireland", "wallace-collection-matinee-and-ikoyi"),
    ],
  },
  {
    id: "q-22",
    query: "Bali: temples at dawn and beach clubs after",
    labels: [
      playbook("vietnam-indonesia", "ubud-terraces-and-tirta-empul-dawn"),
      playbook("vietnam-indonesia", "uluwatu-cliffs-kecak-jimbaran"),
    ],
  },
  {
    id: "q-23",
    query: "Istanbul in 2 days, old city and the Bosphorus",
    labels: [
      playbook("turkey-balkans", "istanbul-sultanahmet-before-the-queues"),
      playbook("turkey-balkans", "istanbul-bosphorus-public-ferry-and-kadikoy"),
    ],
  },
  {
    id: "q-24",
    query: "Finger Lakes wine weekend in the fall",
    labels: [
      playbook("finger-lakes-upstate-ny", "keuka-hammondsport-and-the-bluff-drive"),
      playbook("finger-lakes-upstate-ny", "harvest-weekend-on-seneca-the-expensive-one"),
    ],
  },
  {
    id: "q-25",
    query: "5 days in Vietnam: Hanoi, Ha Long Bay, Hoi An",
    labels: [
      playbook("vietnam-indonesia", "hanoi-old-quarter-bun-cha"),
      playbook("vietnam-indonesia", "lan-ha-bay-private-charter"), // Lan Ha Bay, Ha Long's quieter neighbour
      playbook("vietnam-indonesia", "hoi-an-tailor-lanterns-an-bang"),
    ],
  },
];
