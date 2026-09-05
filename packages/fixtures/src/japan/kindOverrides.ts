// Stops whose `kind` deliberately disagrees with the design export's `status`,
// and why.
//
// The export (.design-sync/handoff/data/japan-trip-seed.json) is the reference
// for stop CONTENT — titles, times, venues, prices. Its `status` field is a
// different thing: a snapshot of how far along the prototype's imaginary
// traveller happened to be, not a fact about the trip. `upstreamDrift.test.ts`
// compares every other field verbatim and fails on any divergence not listed
// here, so a re-sync that genuinely retimes or renames a stop still cannot pass
// unnoticed — this list buys exactly five rows of latitude and no more.
//
// Why they were changed (Mitchell, 2026-08-29). The export leaves 50 of 72
// stops in a state that `N to book` counts, which made every single day on the
// Calendar carry a flag — "the one actionable thing at this zoom", on all
// fourteen days at once. Two changes fixed that together: `needsBooking` got
// narrower (see apps/web/src/lib/needsBooking.ts), and this file re-profiles
// the trip to look like one somebody has actually worked on, rather than one
// where nothing has been confirmed.
//
// The shape of the edit is deliberate: it moves things a real traveller would
// have locked in ten days out, and leaves untouched everything that is
// genuinely still open. Nothing here converts an `idea` — the six ideas are
// the trip's "maybe" story and are the point of having the kind at all.
export const KIND_OVERRIDES: Record<string, { upstream: string; ours: string; why: string }> = {
  "d5-s5-omakase-at-sushi-yoshitake": {
    upstream: "hold",
    ours: "booked",
    why: "An omakase counter is booked weeks out or not at all; leaving it holding is the least believable row in the export.",
  },
  "d2-s5-yakitori-at-torishiki": {
    upstream: "hold",
    ours: "booked",
    why: "Same class — a reservation-only counter that nobody holds tentatively.",
  },
  "d8-s6-dinner-at-giro-giro-hitoshina": {
    upstream: "hold",
    ours: "booked",
    why: "Kaiseki with a fixed seating; one of three dinners now confirmed, which is what a worked-on trip looks like.",
  },
  "d5-s2-nezu-museum": {
    upstream: "planned",
    ours: "booked",
    why: "Timed entry. Two of the trip's four ticketed museums are now bought so the remaining two read as real outstanding work rather than as the default state of every museum.",
  },
  "d13-s4-benesse-house-and-yellow-pumpkin": {
    upstream: "planned",
    ours: "booked",
    why: "Bundled with the Chichū ticket the export already has as booked; buying one and not the other was an inconsistency in the export, not a plan.",
  },
};
