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
  // Still a gap — the VENUE is uncorroborated — but its coordinate is now the
  // right village rather than the sea, and the distinction is the point.
  //
  // Mitchell, 2026-08-30, on the Map lens: the pin rendered in the water. The
  // stored 34.4565,134.008 sat INSIDE Naoshima's viewbox and ~1.2km from the
  // nearest other stop, so neither the box nor cityGeography.test.ts could
  // ever have flagged it — being in the right city is not the same as being
  // on land. That is the hole this file does not close on its own, and a
  // human looking at the map is what found it.
  //
  // He then ran two keyed lookups. The real address he supplied — 761-1,
  // Naoshima, Kagawa District, Kagawa 761-3110 — does NOT resolve: LocationIQ
  // returned the town, `Naoshima, Kagawa County, Kagawa Prefecture`, with no
  // street or building, confirming this entry's original diagnosis. Querying
  // the village instead returned `Honmura, Naoshima, Kagawa County, Kagawa
  // Prefecture, 761-3199` at 34.4602827,133.9951957, which is what ./trip.ts
  // now carries.
  //
  // **That is a village centroid, not Aisunao.** It is ~143m from the Chichū
  // Art Museum pin, because a village-level point is all the vendor has for
  // this part of the island. It is on land, it matches the stop's `area`
  // ("Honmura"), and it is 1.25km better than what it replaces — but nobody
  // should later read it as a surveyed position for the restaurant.
  "d13-s3-lunch-at-aisunao":
    'Venue 404s on "Aisunao, Honmura, Naoshima, Japan" (2026-08-30), and the postal address 761-1 / 761-3110 resolves only to the town. trip.ts carries the Honmura VILLAGE centroid (34.4602827,133.9951957, LocationIQ 2026-08-30) — on land and in the right village, but not the venue.',
  "d14-s3-last-lunch-at-maisen":
    '404 on "Tonkatsu Maisen, Omotesandō, Tokyo, Japan" (2026-08-30). Well known to visitors, absent from OSM under this name.',
};
