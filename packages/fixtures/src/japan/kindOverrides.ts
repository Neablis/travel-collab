// Stops whose `kind` deliberately disagrees with the design export's `status`,
// and why.
//
// The export (.design-sync/handoff/data/japan-trip-seed.json) is the reference
// for stop CONTENT — titles, times, venues, prices. Its `status` field is a
// different thing: a snapshot of how far along the prototype's imaginary
// traveller happened to be, not a fact about the trip. `upstreamDrift.test.ts`
// compares every other field verbatim and fails on any divergence not listed
// here, so a re-sync that genuinely retimes or renames a stop still cannot pass
// unnoticed — this list buys exactly three rows of latitude and no more.
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
// the trip's "maybe" story and are the point of having a `pending` kind at all.
//
// **Read through M28's translation** (ADR-054). The export still says
// `booked`/`hold`/`idea`; `upstreamDrift.test.ts` reads each `status` through
// `readActivityKind` before comparing, so `upstream` below is the export's own
// word and `ours` is one of the three kinds. Two overrides went away with
// M28: Nezu and Benesse were `planned` → `booked`, and `booked` now reads as
// `planned`, so they no longer disagree with the export at all.
export const KIND_OVERRIDES: Record<string, { upstream: string; ours: string; why: string }> = {
  "d5-s5-omakase-at-sushi-yoshitake": {
    upstream: "hold",
    ours: "planned",
    why: "An omakase counter is booked weeks out or not at all; leaving it holding is the least believable row in the export.",
  },
  "d2-s5-yakitori-at-torishiki": {
    upstream: "hold",
    ours: "planned",
    why: "Same class — a reservation-only counter that nobody holds tentatively.",
  },
  "d8-s6-dinner-at-giro-giro-hitoshina": {
    upstream: "hold",
    ours: "planned",
    why: "Kaiseki with a fixed seating; one of three dinners now confirmed, which is what a worked-on trip looks like.",
  },
};
