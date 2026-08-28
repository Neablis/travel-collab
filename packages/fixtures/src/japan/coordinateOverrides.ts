// Stops whose canonical coordinates deliberately disagree with the geocode
// overlay (./coordinates.json), and why.
//
// The overlay is scripts/geocode-japan-seed.mts's output. It is a PROPOSAL,
// not the reference. KI-39 hardened that script to reject candidates outside
// the right city, but "inside Tokyo" is a ~60km box, so it still accepts the
// wrong *venue* within the right city. Each entry below records what it
// actually matched, read off the overlay's own `canonicalName`.
//
// Six are plainly the wrong place. Until this package existed,
// japanTripImporter.ts fed the overlay straight into the preview branch's
// reset route — so on the preview deployment those six stops rendered at
// coordinates for somewhere else, while local dev (which used db-seed's
// hand-authored values) rendered them correctly. Routing every caller through
// ./trip.ts ends that split: the hand-authored coordinates, which the local
// browser walks were done against, are now what every surface gets.
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
  // --- overlay matched the wrong place ---
  "d2-s1-coffee-at-onibus": 'overlay matched "Onibus Coffee, Setagaya" — the wrong branch; the stop is Nakameguro',
  "d2-s4-hama-rikyu-gardens": 'overlay matched "Tokyo, Chiyoda, Tokyo" — a city centroid, not the garden',
  "d2-s5-yakitori-at-torishiki": 'overlay matched "MeGuro, Shinagawa" — a locality, not the restaurant',
  "d3-s1-breakfast-at-bread-espresso": 'overlay matched "Cawaii Bread & Coffee, Chūō" — a different café',
  "d5-s5-omakase-at-sushi-yoshitake": 'overlay matched "Sushi Wasabi, Shinjuku" — a different restaurant, wrong ward',
  "d9-s3-lunch-at-yoshida-ya": 'overlay matched "Coffee Yoshida, Kyoto-shi" — a different venue',

  // --- right venue, coordinates differ; hand-authored value kept ---
  "d4-s5-train-back-to-tokyo": 'overlay matched 東武日光駅 (Tobu Nikkō Station), the right station, 1.3km away',
  "d6-s4-check-in-at-gora-kadan": "overlay matched Gōra Kadan, the right ryokan, 1.3km away",
  "d6-s5-kaiseki-dinner-at-the-ryokan": "same venue as the check-in above, same 1.3km difference",
  "d9-s1-breakfast-at-walden-woods": "overlay matched ウォールデンウッズ (Walden Woods), the right café, 1.9km away",
  "d13-s2-chichu-art-museum": "overlay matched 地中美術館 (Chichū Art Museum), the right museum, 1.6km away",
  "d13-s4-benesse-house-and-yellow-pumpkin":
    "overlay matched ベネッセアートサイト直島 (Benesse Art Site Naoshima), the right site, 1.2km away",
};
