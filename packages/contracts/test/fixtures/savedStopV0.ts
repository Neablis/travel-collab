// The oldest `saved_days.stops` bytes this repo knows it has written
// (KI-2026-09-05-l): stops exactly as the M11 write path stored them, before
// M23 added `dayIndex`. `SavedStop` as of `cccbac8` (2026-09-14, the oldest
// commit carrying `saved.ts`) — eight fields, all required — with each nested
// schema (`TimeWindow`, `Location`, `Anchor`, `Money`) at its shape in that
// same commit.
//
// **FROZEN.** This file is the guard, not a sample: `saved.test.ts` parses it
// through `SavedStop.array()`, the parse both read sites run, and a new
// required field — on `SavedStop` or on anything nested in it — fails that
// test instead of emptying every library in production. The fix for a red
// test is a `.default()` on the new field, never an edit here. A row carrying
// a field this file lacks was written after it; add a LATER fixture beside
// this one if that shape ever needs pinning too.
//
// Each stop is the minimum its schema then required, so an optional field
// that later turns required is caught. The populated stop carries every
// optional nested field that existed then, so a tightened one is caught too.
//
// Typed `unknown` on purpose — a golden typed by the schema it guards cannot
// catch drift in it.
export const SAVED_STOPS_V0_GOLDEN: unknown = [
  // Every nullable field null, every array empty: the barest legal stop.
  {
    title: "Wander",
    timeWindow: null,
    location: null,
    notes: null,
    anchors: [],
    kind: "idea",
    tags: [],
    cost: null,
  },
  // Every nullable field populated at its minimum; one anchor of each kind.
  {
    title: "Fushimi Inari",
    timeWindow: { start: "09:00", end: "11:00" },
    location: { name: "Fushimi Inari Taisha" },
    notes: "Go early.",
    anchors: [
      { kind: "dayOfWeek", days: ["sat"] },
      { kind: "dateRange", from: "2026-04-01", to: "2026-04-10" },
      { kind: "timeOfDay", window: { start: "06:00", end: "08:00" } },
      { kind: "publicHoliday", country: "JP" },
    ],
    kind: "planned",
    tags: ["outdoors"],
    cost: { amountMinor: 0, currency: "JPY" },
  },
  // A geocoded location, with every optional field `Location` had then.
  {
    title: "Nishiki Market",
    timeWindow: { start: "12:00", end: "13:30" },
    location: {
      name: "Nishiki Market",
      lat: 35.005,
      lng: 135.764,
      countryCode: "JP",
      city: "Kyoto",
      area: "Nakagyo",
      precision: "venue",
    },
    notes: null,
    anchors: [],
    kind: "booked",
    tags: ["meal", "ticketed"],
    cost: { amountMinor: 3500, currency: "JPY" },
  },
];

/** The top-level keys every stop above carries — the whole of `SavedStop` at v0. */
export const SAVED_STOP_V0_KEYS = ["title", "timeWindow", "location", "notes", "anchors", "kind", "tags", "cost"];
