// Stops the geocoder was asked about and could not corroborate at all, and why.
//
// This is the third state, and it existed unrecorded until 2026-08-30.
// ./coordinateOverrides.ts covers stops where the overlay proposes a DIFFERENT
// coordinate and we keep ours. This file covers stops where the overlay has no
// entry whatsoever — the vendor answered "no such place".
//
// Why it needed a file of its own: `verify.ts` skipped any row absent from the
// overlay (`if (!resolved) … continue`), so "LocationIQ has never heard of this
// venue" and "nobody has run the geocoder yet" were the same silence. That is
// why the unresolved count never converged and why re-running the script kept
// looking like a failure — the report could count the misses but nothing could
// say which of them were expected.
//
// Every entry below is a definitive vendor negative (HTTP 404 with
// {"error":"Unable to geocode"}), observed on the 2026-08-30 run, quoted with
// the exact query that produced it. They are NOT lookup failures: rerunning
// them changes nothing, which is the distinction KI-78 taught the script to
// draw and this file records the consequence of.
//
// **These stops are not missing coordinates.** ./trip.ts is canonical since
// ADR-030 and carries a hand-authored lat/lng for every one of them; the app
// renders their pins correctly. What is missing is independent corroboration,
// and for these eight it is not obtainable from this vendor at any effort.
//
// The pattern is not random: every one is a small, independent, owner-operated
// Japanese venue. That is a structural weakness of an OpenStreetMap-derived
// geocoder, not bad luck, and choosing what to do about it is
// KI-2026-08-30-f — do not paper over it by hand-entering vendor data here.
//
// verify.ts fails if an entry here names no row, or if the vendor later DOES
// resolve one — the same staleness discipline COORDINATE_OVERRIDES carries, so
// this list cannot quietly stop describing reality.

export const COORDINATE_GAPS: Readonly<Record<string, string>> = {
  "d4-s3-lunch-at-hippari-dako":
    '404 on "Hippari Dako, Nikkō, Nikkō, Japan" (2026-08-30). A one-room dumpling shop near Shinkyō; no OSM node.',
  "d5-s1-coffee-at-koffee-mameya":
    '404 on "Koffee Mameya, Omotesandō, Tokyo, Japan" (2026-08-30). Counter-only roastery on a back lane; unmapped.',
  "d7-s4-check-in-at-nazuna-gosho":
    '404 on "Nazuna Kyoto Gosho, Kamigyō, Kyoto, Japan" (2026-08-30). A machiya conversion; the building predates the brand and OSM carries neither name.',
  "d8-s4-lunch-at-omen-kodaiji":
    '404 on "Omen Kodaiji, Higashiyama, Kyoto, Japan" (2026-08-30). Branch of a small udon chain; the Kodaiji branch is absent.',
  "d8-s6-dinner-at-giro-giro-hitoshina":
    '404 on "Giro Giro Hitoshina, Shimogyō, Kyoto, Japan" (2026-08-30). Riverside kaiseki counter; unmapped.',
  "d9-s4-tea-at-ippodo-kaboku":
    '404 on "Ippodo Kaboku, Nakagyō, Kyoto, Japan" (2026-08-30). The tearoom annexe of Ippodo; the parent shop may exist, the annexe does not.',
  // The one entry here that is known to be WRONG rather than merely
  // uncorroborated, which is the distinction this whole file exists to draw
  // and the reason it is not enough on its own. Mitchell, 2026-08-30, looking
  // at the Map lens: the pin renders in the sea. Its stored 34.4565,134.008
  // sits INSIDE Naoshima's viewbox and ~1.2km from the nearest other stop, so
  // neither the box nor cityGeography.test.ts could ever have flagged it —
  // being in the right city is not the same as being on land.
  //
  // The real address, supplied by Mitchell: 761-1, Naoshima, Kagawa District,
  // Kagawa 761-3110, Japan. Recorded here rather than converted, because
  // turning it into a lat/lng needs a geocoder and inventing one is exactly
  // the failure the note at the top of this file forbids. Whoever has the
  // LOCATIONIQ_API_KEY should run that address, or paste the coordinate.
  "d13-s3-lunch-at-aisunao":
    '404 on "Aisunao, Honmura, Naoshima, Japan" (2026-08-30). A house-restaurant on an island of 3,000 people. STORED COORDINATE IS WRONG — renders in the sea; real address 761-1, Naoshima, Kagawa District, Kagawa 761-3110, Japan, awaiting a lookup.',
  "d14-s3-last-lunch-at-maisen":
    '404 on "Tonkatsu Maisen, Omotesandō, Tokyo, Japan" (2026-08-30). Well known to visitors, absent from OSM under this name.',
};
