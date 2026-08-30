// Stops whose canonical coordinates deliberately disagree with the geocode
// overlay (./coordinates.json), and why.
//
// The overlay is scripts/geocode-japan-seed.mts's output. It is a PROPOSAL,
// not the reference. KI-39 hardened that script to reject candidates outside
// the right city, but "inside Tokyo" is a ~60km box, so it could still accept
// the wrong *venue* within the right city. Each entry below records what it
// actually matched, read off the overlay's own `canonicalName`.
//
// Six used to be plainly the wrong place. Until this package existed,
// japanTripImporter.ts fed the overlay straight into the preview branch's
// reset route — so on the preview deployment those six stops rendered at
// coordinates for somewhere else, while local dev (which used db-seed's
// hand-authored values) rendered them correctly. Routing every caller through
// ./trip.ts ended that split: the hand-authored coordinates, which the local
// browser walks were done against, are what every surface gets.
//
// KI-58 then closed the tool half. Re-running the script on 2026-08-29 (the
// run that produced the current ./coordinates.json) no longer matches five of
// those six at all — the name-identity check rejects them outright, and the
// overlay simply has no entry for those stops now, which is why they are no
// longer listed below. What survives is the case that check cannot make: two
// stops whose overlay match is name-identical to the queried venue and is the
// wrong BRANCH of the same chain. The script now reports those as
// "area-uncorroborated" instead of accepting them quietly.
//
// The other six are the RIGHT venue with an offset of 1.2-1.9km. Which of the
// two points is more precise is not established here, and the entries say so
// rather than guessing; the hand-authored value is kept because it is the one
// that has been looked at on screen.
//
// verify.ts fails on any disagreement NOT listed here, so re-running the
// geocoder cannot silently move a coordinate: it either agrees, or it lands
// here with a reason written next to it.

export const COORDINATE_OVERRIDES: Readonly<Record<string, string>> = {
  // --- overlay matched the wrong BRANCH of the right chain (KI-58's residue) ---
  // Both entries below are name-identical to the queried venue and sit inside
  // the right city box, so neither the box nor the name-identity check can
  // reject them — only the ward tells the branches apart. The 2026-08-29 run
  // reports both as "area-uncorroborated" rather than accepting them silently,
  // which is the part that is fixed; picking the right branch needs a
  // candidate for it to exist in the vendor's top 5, and for these two it did
  // not. The hand-authored coordinate is the right one and is kept.
  "d2-s1-coffee-at-onibus": 'overlay matched "Onibus Coffee, Setagaya" — the wrong branch; the stop is Nakameguro',
  "d3-s3-lunch-at-afuri": 'overlay matched "Afuri, Minato" — the wrong branch; the stop is Harajuku (2.8km)',

  // --- right venue, coordinates differ; hand-authored value kept ---
  "d4-s5-train-back-to-tokyo": 'overlay matched 東武日光駅 (Tobu Nikkō Station), the right station, 1.3km away',
  "d6-s4-check-in-at-gora-kadan": "overlay matched Gōra Kadan, the right ryokan, 1.3km away",
  "d6-s5-kaiseki-dinner-at-the-ryokan": "same venue as the check-in above, same 1.3km difference",
  "d9-s1-breakfast-at-walden-woods": "overlay matched ウォールデンウッズ (Walden Woods), the right café, 1.9km away",
  "d13-s2-chichu-art-museum": "overlay matched 地中美術館 (Chichū Art Museum), the right museum, 1.6km away",
  "d13-s4-benesse-house-and-yellow-pumpkin":
    "overlay matched ベネッセアートサイト直島 (Benesse Art Site Naoshima), the right site, 1.2km away",
};
