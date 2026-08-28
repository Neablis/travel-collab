// The canonical Japan demo trip — 14 days, 6 cities, 68 scheduled stops and a
// 4-item backlog. This file is the SINGLE source of truth for that trip.
//
// It is consumed by every surface that needs rich, realistic data:
//   - apps/web/scripts/db-seed.ts        local dev DB (`pnpm --filter web db:reseed`)
//   - apps/web/src/app/api/dev/reset-demo-data/route.ts   the preview-only reset
//   - @tc/factories's `japanTrip` scenario                 tests that need real richness
//   - ./verify.ts                                          the correctness harness
// Before ADR-030 the first two carried SEPARATE, hand-maintained copies of
// these same 72 rows. They happened to agree; nothing made them.
//
// --- Provenance, and what is ours vs. upstream's ---
// Structure, times, `kind`, cost, `note` and `who` come from the design
// handoff's own export (.design-sync/handoff/data/japan-trip-seed.json,
// schema `trip-seed/v1`). That file is an UPSTREAM DROP — it is re-synced from
// the design-system project and must never be edited here, which is why this
// package owns a copy rather than reading across into it. `upstreamDrift.test.ts`
// asserts every field below still matches that export, so a re-sync that
// changes the trip fails loudly instead of diverging in silence.
//
// `tags`, `lat`/`lng` and the backlog's `city` are OURS — the export carries
// none of them (its `enums` block lists only `stopStatus`). Tags are
// hand-authored per M18's rule that inferring them from title text is the
// prose parse that milestone disqualifies. Coordinates are the union of
// scripts/geocode-japan-seed.mts's verified output (51 of 72 — see KI-39) and
// hand-authored values for the 21 the geocoder could not resolve to the right
// venue; `verify.ts` checks the two still agree wherever both have an opinion.
//
// --- Adding data for a new feature ---
// See docs/guidelines/fixtures-and-seed-data.md. Short version: add the field
// here, extend `expectations.ts` so every value of a new enum is covered, and
// `pnpm seed:verify` will tell you what you missed.

import type { ActivityKind, ActivityTag } from "@tc/contracts";

/** One scheduled stop, placed on a numbered day. */
export type JapanStop = {
  /** The upstream export's own stop id. Never emitted in a command — it keys
   *  the drift test and the geocode overlay. */
  id: string;
  /** 1-based day number; `day: 1` is the trip's start date. */
  day: number;
  title: string;
  place: string;
  area: string;
  /**
   * The containing day's city, denormalised. Upstream models this as
   * `days[].city`; a stop carries no city of its own there.
   *
   * A DAY IS TAGGED WITH ITS DESTINATION, so on the seven transition stops
   * this is deliberately not the city the stop is physically in: day 4's
   * "Limited Express to Nikkō" departs Tobu Asakusa Station in Tokyo and is
   * tagged Nikkō; day 14's hotel breakfast is at Zentis Osaka and is tagged
   * Tokyo. It reads oddly in `Location.name` ("Zentis Osaka, Kita, Tokyo,
   * Japan") and it is on purpose — this rationale was carried over from
   * db-seed.ts, which recorded it against day 14:
   *
   *   > Tagged Tokyo throughout (the day's destination city), matching how
   *   > days 7 and 11 (the other city-transition days) are tagged with their
   *   > arrival city rather than split — splitting this one triggered a pile
   *   > of "same day, ~400km apart" distance warnings between the
   *   > Osaka-morning and Tokyo-evening stops, which is accurate but noisy
   *   > for a fixture.
   *
   * Nothing groups by anything else: `cityFor()` picks a day's name and accent
   * from its activities' `city`, and the calendar's city cards group strictly
   * on it. Splitting these seven would change the day accents, the calendar
   * cards and the conflict baseline, so it is a product decision rather than a
   * correction. Raised by CodeRabbit on PR #74 and recorded as KI-59.
   */
  city: string;
  start: string;
  end: string;
  kind: ActivityKind;
  tags: ActivityTag[];
  /** Whole USD, as the export's estimator produced it. `null` = an "idea"
   *  stop with no estimate yet. Converted to minor units in commands.ts. */
  costUsd: number | null;
  note: string | null;
  /** "all", or the travellers this stop is for. Folded into the activity's
   *  notes by commands.ts — Trip Planning has no field for it (module map). */
  who: "all" | string[];
  lat: number;
  lng: number;
};

/** A parked idea with no day and no time window. */
export type JapanBacklogItem = Omit<JapanStop, "day" | "start" | "end" | "costUsd">;

export const JAPAN_TRIP_NAME = "Japan: Tokyo → Kyoto → Osaka";
export const JAPAN_TRIP_DAY_COUNT = 14;
/** Whole USD. `commands.ts` converts to minor units. */
export const JAPAN_TRIP_BUDGET_USD = 16400;
export const JAPAN_TRIP_CURRENCY = "USD";
/** Every location this trip creates sits in Japan. */
export const JAPAN_COUNTRY_CODE = "JP";

/**
 * The start date used whenever the trip must be dated but the actual date must
 * not vary: `verify.ts`'s report, and any test asserting on a date. Real
 * seeders pass a date relative to today instead, so the demo trip is always
 * upcoming — nothing about the trip's SHAPE depends on which date it is.
 *
 * Lives here rather than in verify.ts so that importing it does not drag
 * @tc/domain into a consumer's import graph. See index.ts.
 */
export const REFERENCE_START_DATE = "2026-09-20";

export const JAPAN_STOPS: readonly JapanStop[] = [
  // Day 1 — Tokyo
  { id: "d1-s1-land-at-haneda", day: 1, title: "Land at Haneda", place: "HND Terminal 3", area: "Ōta", city: "Tokyo", start: "14:30", end: "16:00", kind: "transit", tags: [], costUsd: 310, note: null, who: "all", lat: 35.5494, lng: 139.7798 },
  { id: "d1-s2-check-in-at-trunk-hotel", day: 1, title: "Check in at Trunk Hotel", place: "Trunk Hotel", area: "Shibuya", city: "Tokyo", start: "17:00", end: "17:30", kind: "booked", tags: ["lodging"], costUsd: 385, note: "Bags to the room, then straight out — nobody sleeps yet.", who: "all", lat: 35.6684, lng: 139.704 },
  { id: "d1-s3-dinner-at-gonpachi", day: 1, title: "Dinner at Gonpachi", place: "Gonpachi Nishiazabu", area: "Nishi-Azabu", city: "Tokyo", start: "19:00", end: "20:30", kind: "hold", tags: ["meal"], costUsd: 295, note: null, who: "all", lat: 35.6564, lng: 139.7238 },
  { id: "d1-s4-nightcap-at-bar-trench", day: 1, title: "Nightcap at Bar Trench", place: "Bar Trench", area: "Ebisu", city: "Tokyo", start: "21:00", end: "22:30", kind: "idea", tags: ["meal"], costUsd: null, note: null, who: ["Sam K", "Jonah M"], lat: 35.6467, lng: 139.7133 },

  // Day 2 — Tokyo
  { id: "d2-s1-coffee-at-onibus", day: 2, title: "Coffee at Onibus", place: "Onibus Coffee", area: "Nakameguro", city: "Tokyo", start: "07:30", end: "08:15", kind: "planned", tags: ["meal"], costUsd: 70, note: null, who: "all", lat: 35.6435, lng: 139.6987 },
  { id: "d2-s2-teamlab-planets", day: 2, title: "teamLab Planets", place: "teamLab Planets", area: "Toyosu", city: "Tokyo", start: "09:00", end: "11:00", kind: "booked", tags: ["ticketed"], costUsd: 355, note: "Timed entry 9 am. Barefoot — no tights.", who: "all", lat: 35.6469, lng: 139.793 },
  { id: "d2-s3-lunch-at-tsukiji-outer-market", day: 2, title: "Lunch at Tsukiji Outer Market", place: "Tsukiji Outer Market", area: "Tsukiji", city: "Tokyo", start: "12:00", end: "13:00", kind: "planned", tags: ["meal"], costUsd: 10, note: null, who: "all", lat: 35.6654, lng: 139.7707 },
  { id: "d2-s4-hama-rikyu-gardens", day: 2, title: "Hama-rikyū Gardens", place: "Hama-rikyū Gardens", area: "Hamamatsuchō", city: "Tokyo", start: "14:00", end: "16:00", kind: "planned", tags: ["outdoors"], costUsd: 15, note: null, who: ["Priya R", "Mei T"], lat: 35.6597, lng: 139.7633 },
  { id: "d2-s5-yakitori-at-torishiki", day: 2, title: "Yakitori at Torishiki", place: "Torishiki", area: "Meguro", city: "Tokyo", start: "19:00", end: "21:00", kind: "hold", tags: ["meal"], costUsd: 315, note: null, who: "all", lat: 35.6339, lng: 139.7157 },

  // Day 3 — Tokyo
  { id: "d3-s1-breakfast-at-bread-espresso", day: 3, title: "Breakfast at Bread & Espresso", place: "Bread & Espresso", area: "Omotesandō", city: "Tokyo", start: "08:00", end: "09:00", kind: "planned", tags: ["meal"], costUsd: 85, note: null, who: "all", lat: 35.6658, lng: 139.7128 },
  { id: "d3-s2-meiji-jingu", day: 3, title: "Meiji Jingū", place: "Meiji Jingū", area: "Yoyogi", city: "Tokyo", start: "09:30", end: "11:30", kind: "planned", tags: ["outdoors"], costUsd: 5, note: null, who: "all", lat: 35.6764, lng: 139.6993 },
  { id: "d3-s3-lunch-at-afuri", day: 3, title: "Lunch at Afuri", place: "Afuri", area: "Harajuku", city: "Tokyo", start: "12:30", end: "14:00", kind: "planned", tags: ["meal"], costUsd: 90, note: null, who: "all", lat: 35.6702, lng: 139.7026 },
  { id: "d3-s4-shimokitazawa-record-shops", day: 3, title: "Shimokitazawa record shops", place: "Shimokitazawa", area: "Setagaya", city: "Tokyo", start: "15:00", end: "17:30", kind: "planned", tags: [], costUsd: 20, note: null, who: ["Jonah M"], lat: 35.6613, lng: 139.6674 },
  { id: "d3-s5-dinner-at-den", day: 3, title: "Dinner at Den", place: "Den", area: "Jingūmae", city: "Tokyo", start: "19:30", end: "21:30", kind: "booked", tags: ["meal"], costUsd: 260, note: "Held with a card. 48h cancellation.", who: "all", lat: 35.6688, lng: 139.7096 },

  // Day 4 — Nikkō
  { id: "d4-s1-limited-express-to-nikko", day: 4, title: "Limited Express to Nikkō", place: "Tobu Asakusa Station", area: "Asakusa", city: "Nikkō", start: "07:10", end: "09:10", kind: "transit", tags: [], costUsd: 100, note: null, who: "all", lat: 35.7107, lng: 139.8017 },
  { id: "d4-s2-tosho-gu-shrine", day: 4, title: "Tōshō-gū Shrine", place: "Tōshō-gū", area: "Nikkō", city: "Nikkō", start: "10:00", end: "12:30", kind: "planned", tags: ["outdoors"], costUsd: 20, note: null, who: "all", lat: 36.7581, lng: 139.5994 },
  { id: "d4-s3-lunch-at-hippari-dako", day: 4, title: "Lunch at Hippari Dako", place: "Hippari Dako", area: "Nikkō", city: "Nikkō", start: "13:00", end: "14:00", kind: "planned", tags: ["meal"], costUsd: 65, note: null, who: "all", lat: 36.7508, lng: 139.5989 },
  { id: "d4-s4-kegon-falls", day: 4, title: "Kegon Falls", place: "Kegon Falls", area: "Chūzenji", city: "Nikkō", start: "15:00", end: "16:30", kind: "planned", tags: ["outdoors"], costUsd: 15, note: null, who: "all", lat: 36.7383, lng: 139.4994 },
  { id: "d4-s5-train-back-to-tokyo", day: 4, title: "Train back to Tokyo", place: "Tobu Nikkō Station", area: "Nikkō", city: "Nikkō", start: "18:30", end: "20:30", kind: "transit", tags: [], costUsd: 135, note: null, who: "all", lat: 36.7578, lng: 139.6122 },

  // Day 5 — Tokyo
  { id: "d5-s1-coffee-at-koffee-mameya", day: 5, title: "Coffee at Koffee Mameya", place: "Koffee Mameya", area: "Omotesandō", city: "Tokyo", start: "09:00", end: "10:00", kind: "planned", tags: ["meal"], costUsd: 65, note: null, who: "all", lat: 35.6674, lng: 139.7104 },
  { id: "d5-s2-nezu-museum", day: 5, title: "Nezu Museum", place: "Nezu Museum", area: "Minami-Aoyama", city: "Tokyo", start: "10:30", end: "13:00", kind: "planned", tags: ["ticketed"], costUsd: 95, note: null, who: ["Priya R", "Mei T"], lat: 35.6641, lng: 139.7168 },
  { id: "d5-s3-lunch-at-kagari", day: 5, title: "Lunch at Kagari", place: "Kagari", area: "Ginza", city: "Tokyo", start: "12:30", end: "14:00", kind: "planned", tags: ["meal"], costUsd: 45, note: null, who: "all", lat: 35.6717, lng: 139.765 },
  { id: "d5-s4-itoya-and-ginza-six", day: 5, title: "Itoya and Ginza Six", place: "Itoya", area: "Ginza", city: "Tokyo", start: "16:00", end: "18:00", kind: "planned", tags: [], costUsd: 125, note: null, who: "all", lat: 35.6733, lng: 139.7644 },
  { id: "d5-s5-omakase-at-sushi-yoshitake", day: 5, title: "Omakase at Sushi Yoshitake", place: "Sushi Yoshitake", area: "Ginza", city: "Tokyo", start: "20:00", end: "22:00", kind: "hold", tags: ["meal"], costUsd: 155, note: "Concierge is chasing this one.", who: "all", lat: 35.671, lng: 139.7638 },

  // Day 6 — Hakone
  { id: "d6-s1-romancecar-to-hakone-yumoto", day: 6, title: "Romancecar to Hakone-Yumoto", place: "Shinjuku Station", area: "Shinjuku", city: "Hakone", start: "08:20", end: "09:55", kind: "transit", tags: [], costUsd: 35, note: null, who: "all", lat: 35.6896, lng: 139.7006 },
  { id: "d6-s2-hakone-open-air-museum", day: 6, title: "Hakone Open-Air Museum", place: "Open-Air Museum", area: "Ninotaira", city: "Hakone", start: "10:30", end: "12:30", kind: "booked", tags: ["ticketed", "outdoors"], costUsd: 475, note: null, who: "all", lat: 35.2444, lng: 139.0464 },
  { id: "d6-s3-lunch-at-bakery-table", day: 6, title: "Lunch at Bakery & Table", place: "Bakery & Table", area: "Motohakone", city: "Hakone", start: "13:00", end: "14:00", kind: "planned", tags: ["meal"], costUsd: 95, note: null, who: "all", lat: 35.201, lng: 139.0269 },
  { id: "d6-s4-check-in-at-gora-kadan", day: 6, title: "Check in at Gora Kadan", place: "Gora Kadan", area: "Gōra", city: "Hakone", start: "16:40", end: "17:10", kind: "booked", tags: ["lodging"], costUsd: 250, note: "Check-in closes at 16:00 — this is the conflict the assistant flagged.", who: "all", lat: 35.2379, lng: 139.0561 },
  { id: "d6-s5-kaiseki-dinner-at-the-ryokan", day: 6, title: "Kaiseki dinner at the ryokan", place: "Gora Kadan", area: "Gōra", city: "Hakone", start: "18:30", end: "20:30", kind: "booked", tags: ["meal"], costUsd: 320, note: null, who: "all", lat: 35.2379, lng: 139.0561 },

  // Day 7 — Kyoto
  { id: "d7-s1-shinkansen-odawara-kyoto", day: 7, title: "Shinkansen Odawara → Kyoto", place: "Odawara Station", area: "Odawara", city: "Kyoto", start: "09:30", end: "11:45", kind: "transit", tags: [], costUsd: 30, note: null, who: "all", lat: 35.2547, lng: 139.1546 },
  { id: "d7-s2-lunch-at-honke-owariya", day: 7, title: "Lunch at Honke Owariya", place: "Honke Owariya", area: "Nakagyō", city: "Kyoto", start: "12:30", end: "13:30", kind: "planned", tags: ["meal"], costUsd: 20, note: null, who: "all", lat: 35.0149, lng: 135.7592 },
  { id: "d7-s3-nijo-castle", day: 7, title: "Nijō Castle", place: "Nijō Castle", area: "Nakagyō", city: "Kyoto", start: "14:30", end: "16:30", kind: "planned", tags: ["ticketed"], costUsd: 75, note: null, who: "all", lat: 35.0142, lng: 135.7481 },
  { id: "d7-s4-check-in-at-nazuna-gosho", day: 7, title: "Check in at Nazuna Gosho", place: "Nazuna Kyoto Gosho", area: "Kamigyō", city: "Kyoto", start: "17:00", end: "17:30", kind: "booked", tags: ["lodging"], costUsd: 305, note: null, who: "all", lat: 35.0246, lng: 135.7601 },
  { id: "d7-s5-dinner-at-gion-nanba", day: 7, title: "Dinner at Gion Nanba", place: "Gion Nanba", area: "Gion", city: "Kyoto", start: "19:00", end: "21:00", kind: "idea", tags: ["meal"], costUsd: null, note: "No reservation yet. Priya wants kaiseki here.", who: "all", lat: 35.0037, lng: 135.7756 },

  // Day 8 — Kyoto
  { id: "d8-s1-fushimi-inari-at-dawn", day: 8, title: "Fushimi Inari at dawn", place: "Fushimi Inari Taisha", area: "Fushimi", city: "Kyoto", start: "06:30", end: "08:00", kind: "planned", tags: ["outdoors"], costUsd: 65, note: "Go before 7 am or the gates are shoulder to shoulder.", who: "all", lat: 34.9671, lng: 135.7727 },
  { id: "d8-s2-breakfast-at-arabica", day: 8, title: "Breakfast at % Arabica", place: "% Arabica", area: "Higashiyama", city: "Kyoto", start: "09:00", end: "10:00", kind: "planned", tags: ["meal"], costUsd: 70, note: null, who: "all", lat: 34.9998, lng: 135.7801 },
  { id: "d8-s3-kiyomizu-dera-and-sannenzaka", day: 8, title: "Kiyomizu-dera and Sannenzaka", place: "Kiyomizu-dera", area: "Higashiyama", city: "Kyoto", start: "10:30", end: "12:30", kind: "planned", tags: ["outdoors"], costUsd: 80, note: null, who: "all", lat: 34.9949, lng: 135.785 },
  { id: "d8-s4-lunch-at-omen-kodaiji", day: 8, title: "Lunch at Omen Kodaiji", place: "Omen Kodaiji", area: "Higashiyama", city: "Kyoto", start: "12:00", end: "13:15", kind: "planned", tags: ["meal"], costUsd: 30, note: null, who: "all", lat: 35.0013, lng: 135.7809 },
  { id: "d8-s5-nishiki-market", day: 8, title: "Nishiki Market", place: "Nishiki Market", area: "Nakagyō", city: "Kyoto", start: "16:00", end: "17:30", kind: "planned", tags: ["meal"], costUsd: 20, note: null, who: ["Jonah M", "Mei T"], lat: 35.005, lng: 135.765 },
  { id: "d8-s6-dinner-at-giro-giro-hitoshina", day: 8, title: "Dinner at Giro Giro Hitoshina", place: "Giro Giro Hitoshina", area: "Shimogyō", city: "Kyoto", start: "19:30", end: "21:30", kind: "hold", tags: ["meal"], costUsd: 90, note: null, who: "all", lat: 35.0028, lng: 135.7683 },

  // Day 9 — Kyoto
  { id: "d9-s1-breakfast-at-walden-woods", day: 9, title: "Breakfast at Walden Woods", place: "Walden Woods", area: "Shimogyō", city: "Kyoto", start: "08:00", end: "09:00", kind: "planned", tags: ["meal"], costUsd: 30, note: null, who: "all", lat: 34.9925, lng: 135.7423 },
  { id: "d9-s2-arashiyama-and-tenryu-ji", day: 9, title: "Arashiyama and Tenryū-ji", place: "Tenryū-ji", area: "Arashiyama", city: "Kyoto", start: "09:45", end: "12:00", kind: "planned", tags: ["outdoors"], costUsd: 85, note: null, who: "all", lat: 35.0159, lng: 135.6742 },
  { id: "d9-s3-lunch-at-yoshida-ya", day: 9, title: "Lunch at Yoshida-ya", place: "Yoshida-ya", area: "Arashiyama", city: "Kyoto", start: "12:30", end: "13:30", kind: "planned", tags: ["meal"], costUsd: 55, note: null, who: "all", lat: 35.0116, lng: 135.6786 },
  { id: "d9-s4-tea-at-ippodo-kaboku", day: 9, title: "Tea at Ippodo Kaboku", place: "Ippodo Kaboku", area: "Nakagyō", city: "Kyoto", start: "15:00", end: "16:30", kind: "planned", tags: ["meal"], costUsd: 80, note: null, who: ["Priya R"], lat: 35.0107, lng: 135.7601 },
  { id: "d9-s5-dinner-at-kichi-kichi", day: 9, title: "Dinner at Kichi Kichi", place: "Kichi Kichi", area: "Pontochō", city: "Kyoto", start: "18:00", end: "19:30", kind: "booked", tags: ["meal"], costUsd: 495, note: null, who: "all", lat: 35.0069, lng: 135.771 },

  // Day 10 — Kyoto
  { id: "d10-s1-ginkaku-ji-and-the-philosopher-s-path", day: 10, title: "Ginkaku-ji and the Philosopher's Path", place: "Ginkaku-ji", area: "Sakyō", city: "Kyoto", start: "09:00", end: "11:00", kind: "planned", tags: ["outdoors"], costUsd: 5, note: null, who: "all", lat: 35.027, lng: 135.7982 },
  { id: "d10-s2-lunch-at-monk", day: 10, title: "Lunch at Monk", place: "Monk", area: "Sakyō", city: "Kyoto", start: "11:30", end: "12:30", kind: "booked", tags: ["meal"], costUsd: 500, note: null, who: "all", lat: 35.0271, lng: 135.7936 },
  { id: "d10-s3-pottery-at-kyoto-handicraft-center", day: 10, title: "Pottery at Kyoto Handicraft Center", place: "Handicraft Center", area: "Sakyō", city: "Kyoto", start: "14:00", end: "16:00", kind: "planned", tags: [], costUsd: 30, note: null, who: ["Mei T"], lat: 35.0202, lng: 135.7784 },

  // Day 11 — Osaka
  { id: "d11-s1-train-kyoto-osaka", day: 11, title: "Train Kyoto → Osaka", place: "Kyoto Station", area: "Shimogyō", city: "Osaka", start: "10:00", end: "10:40", kind: "transit", tags: [], costUsd: 190, note: null, who: "all", lat: 34.9858, lng: 135.7588 },
  { id: "d11-s2-check-in-at-zentis-osaka", day: 11, title: "Check in at Zentis Osaka", place: "Zentis Osaka", area: "Kita", city: "Osaka", start: "11:30", end: "12:00", kind: "booked", tags: ["lodging"], costUsd: 465, note: null, who: "all", lat: 34.6971, lng: 135.4938 },
  { id: "d11-s3-lunch-at-harukoma-sushi", day: 11, title: "Lunch at Harukoma Sushi", place: "Harukoma Sushi", area: "Nakazakichō", city: "Osaka", start: "12:30", end: "14:00", kind: "planned", tags: ["meal"], costUsd: 30, note: null, who: "all", lat: 34.7043, lng: 135.5064 },
  { id: "d11-s4-osaka-castle-park", day: 11, title: "Osaka Castle Park", place: "Osaka Castle", area: "Chūō", city: "Osaka", start: "15:00", end: "17:00", kind: "planned", tags: ["outdoors"], costUsd: 10, note: null, who: "all", lat: 34.6873, lng: 135.5262 },
  { id: "d11-s5-dotonbori-food-crawl", day: 11, title: "Dōtonbori food crawl", place: "Dōtonbori", area: "Chūō", city: "Osaka", start: "19:00", end: "21:30", kind: "planned", tags: ["meal"], costUsd: 15, note: "Five stops, one bite each. Jonah is picking.", who: "all", lat: 34.6687, lng: 135.5013 },

  // Day 12 — Osaka
  { id: "d12-s1-breakfast-at-mel-coffee", day: 12, title: "Breakfast at Mel Coffee", place: "Mel Coffee Roasters", area: "Nishi", city: "Osaka", start: "08:30", end: "09:30", kind: "planned", tags: ["meal"], costUsd: 75, note: null, who: "all", lat: 34.6811, lng: 135.4894 },
  { id: "d12-s2-nakanoshima-museum", day: 12, title: "Nakanoshima Museum", place: "Nakanoshima Museum", area: "Kita", city: "Osaka", start: "10:00", end: "12:00", kind: "planned", tags: ["ticketed"], costUsd: 100, note: null, who: ["Priya R", "Mei T"], lat: 34.6937, lng: 135.4934 },
  { id: "d12-s3-lunch-at-kuromon-market", day: 12, title: "Lunch at Kuromon Market", place: "Kuromon Ichiba", area: "Chūō", city: "Osaka", start: "13:00", end: "14:30", kind: "planned", tags: ["meal"], costUsd: 20, note: null, who: "all", lat: 34.6656, lng: 135.5064 },
  { id: "d12-s4-shinsekai-and-tsutenkaku", day: 12, title: "Shinsekai and Tsūtenkaku", place: "Tsūtenkaku", area: "Naniwa", city: "Osaka", start: "16:00", end: "18:00", kind: "planned", tags: [], costUsd: 120, note: null, who: "all", lat: 34.6524, lng: 135.5063 },
  { id: "d12-s5-kushikatsu-at-yaekatsu", day: 12, title: "Kushikatsu at Yaekatsu", place: "Yaekatsu", area: "Naniwa", city: "Osaka", start: "20:00", end: "22:00", kind: "hold", tags: ["meal"], costUsd: 370, note: null, who: "all", lat: 34.6529, lng: 135.5083 },

  // Day 13 — Naoshima
  { id: "d13-s1-train-and-ferry-to-naoshima", day: 13, title: "Train and ferry to Naoshima", place: "Uno Port", area: "Tamano", city: "Naoshima", start: "07:00", end: "10:00", kind: "transit", tags: [], costUsd: 130, note: null, who: "all", lat: 34.4903, lng: 133.9491 },
  { id: "d13-s2-chichu-art-museum", day: 13, title: "Chichū Art Museum", place: "Chichū Art Museum", area: "Naoshima", city: "Naoshima", start: "10:30", end: "12:30", kind: "booked", tags: ["ticketed"], costUsd: 340, note: "Timed ticket 10:30 am. Late arrivals are turned away.", who: "all", lat: 34.459, lng: 133.995 },
  { id: "d13-s3-lunch-at-aisunao", day: 13, title: "Lunch at Aisunao", place: "Aisunao", area: "Honmura", city: "Naoshima", start: "13:00", end: "14:00", kind: "planned", tags: ["meal"], costUsd: 95, note: null, who: "all", lat: 34.4565, lng: 134.008 },
  { id: "d13-s4-benesse-house-and-yellow-pumpkin", day: 13, title: "Benesse House and Yellow Pumpkin", place: "Benesse House", area: "Naoshima", city: "Naoshima", start: "14:30", end: "16:30", kind: "planned", tags: ["ticketed", "outdoors"], costUsd: 130, note: null, who: "all", lat: 34.4551, lng: 133.9945 },
  { id: "d13-s5-ferry-and-train-back-to-osaka", day: 13, title: "Ferry and train back to Osaka", place: "Miyanoura Port", area: "Naoshima", city: "Naoshima", start: "17:30", end: "20:30", kind: "transit", tags: [], costUsd: 180, note: null, who: "all", lat: 34.4614, lng: 133.9782 },

  // Day 14 — Tokyo
  { id: "d14-s1-breakfast-at-the-hotel", day: 14, title: "Breakfast at the hotel", place: "Zentis Osaka", area: "Kita", city: "Tokyo", start: "08:00", end: "08:45", kind: "planned", tags: ["meal"], costUsd: 25, note: null, who: "all", lat: 34.6971, lng: 135.4938 },
  { id: "d14-s2-shinkansen-to-tokyo", day: 14, title: "Shinkansen to Tokyo", place: "Shin-Osaka Station", area: "Yodogawa", city: "Tokyo", start: "09:30", end: "11:45", kind: "transit", tags: [], costUsd: 140, note: null, who: "all", lat: 34.7333, lng: 135.5002 },
  { id: "d14-s3-last-lunch-at-maisen", day: 14, title: "Last lunch at Maisen", place: "Tonkatsu Maisen", area: "Omotesandō", city: "Tokyo", start: "12:30", end: "14:00", kind: "planned", tags: ["meal"], costUsd: 40, note: null, who: "all", lat: 35.6659, lng: 139.7123 },
  { id: "d14-s4-transfer-to-haneda", day: 14, title: "Transfer to Haneda", place: "HND Terminal 3", area: "Ōta", city: "Tokyo", start: "16:30", end: "18:00", kind: "booked", tags: [], costUsd: 175, note: null, who: "all", lat: 35.5494, lng: 139.7798 },
  { id: "d14-s5-flight-home", day: 14, title: "Flight home", place: "HND Terminal 3", area: "Ōta", city: "Tokyo", start: "20:10", end: "21:00", kind: "booked", tags: [], costUsd: 160, note: "Check-in opens 5:10 pm.", who: "all", lat: 35.5494, lng: 139.7798 },
];

export const JAPAN_BACKLOG: readonly JapanBacklogItem[] = [
  { id: "b1", title: "Kiyomizu-dera at golden hour", place: "Kiyomizu-dera", area: "Higashiyama", city: "Kyoto", kind: "idea", tags: [], note: "Priya added it", who: "all", lat: 34.9949, lng: 135.785 },
  { id: "b2", title: "Kōenji vintage crawl", place: "Kōenji", area: "Suginami", city: "Tokyo", kind: "idea", tags: [], note: "Jonah added it", who: ["Jonah M"], lat: 35.7057, lng: 139.6497 },
  { id: "b3", title: "Nishiki Market", place: "Nishiki Market", area: "Nakagyō", city: "Kyoto", kind: "idea", tags: [], note: "From a saved day", who: "all", lat: 35.005, lng: 135.765 },
  { id: "b4", title: "Ghibli Museum, if tickets appear", place: "Ghibli Museum", area: "Mitaka", city: "Tokyo", kind: "idea", tags: ["ticketed"], note: "Mei added it", who: "all", lat: 35.696, lng: 139.5704 },
];
