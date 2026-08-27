// The single seam listing every not-yet-functional surface. M9/M11 remove their
// entries as they wire each shell up. A sync test keeps this in lockstep with
// actual <Preview id> usage.
// M11 link 3 removed "trip-invites" (SettingsSheet's mocked invite row — now
// the real TravelersPanel) and "wizard-invite-list" (the wizard's mocked
// "You / Owner" list — now a sentence pointing at Trip settings, because the
// wizard runs before the trip an invite would attach to exists).
export const PREVIEW_REGISTRY = {
  "home-playbooks-strip": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  // The rail's chrome (header/Hide) and ask box are real as of the M10
  // redesign-feedback follow-up — composeAiPlan, the same real M7 feature
  // the board's old ComposePanel used to expose directly. Only the quick-ask
  // nudge chips are still M9/not-built.
  //
  // "assistant-suggestions" (the "What I noticed" shelf) was deleted rather
  // than left shelved — Mitchell, preview feedback on PR #55: the design's
  // panel has no such block, only the conversation and the ask box. Nothing
  // to wire up in M9 because there is nothing there to wire.
  "assistant-quick-asks": { milestone: "M9", wiredUpBy: "M9 proactive suggestions" },
  "timeline-ghost": { milestone: "M9", wiredUpBy: "M9 propose→review→approve" },
  "keep-day-flag": { milestone: "M11", wiredUpBy: "M11 keep-a-day" },
  "keep-day-dialog": { milestone: "M11", wiredUpBy: "M11 keep-a-day" },
  "playbooks-route": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  "insert-playbook": { milestone: "M11", wiredUpBy: "M11 insert-a-Playbook" },
  "share-button": { milestone: "M11", wiredUpBy: "M11 share links" },
  "add-saved-day": { milestone: "M11", wiredUpBy: "M11 add-a-saved-day" },
  "map-legend-modes": { milestone: "M9", wiredUpBy: "Transport mode per leg — no field models it today" },
  "rack-provenance": { milestone: "M11", wiredUpBy: "Who parked a stop, and which day it came from — no field models either" },
  "cost-estimate-state": { milestone: "M11", wiredUpBy: "Confirmed-vs-estimate flag per cost — no field models it" },
  "budget-breakdown": { milestone: "M11", wiredUpBy: "Booked/Holds/Travel/Other categories — no field classifies a cost" },
  "add-stop-suggestions": { milestone: "M9", wiredUpBy: "Grounded place search — nothing generates matches yet" },
  "add-stop-who": { milestone: "M13", wiredUpBy: "Per-stop attribution — no field records who a stop is for" },
  "wizard-destination-chips": { milestone: "M11", wiredUpBy: "No destination field on TripSummary/TripDetail to read recent-and-nearby from" },
  "wizard-playbook-panel": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  "wizard-longer-chip": { milestone: "M11", wiredUpBy: "Manual day-count entry beyond the four preset lengths — no UI for it yet" },
  "wizard-pace-tags": { milestone: "M9", wiredUpBy: "Pace and tags exist only to feed the assistant's draft" },
  "wizard-assistant-draft": { milestone: "M9", wiredUpBy: "M9 proactive drafting" },
  "landing-peek-trip": { milestone: "M11", wiredUpBy: "M11 share links — unauthenticated read of a real trip" },
  // The landing page asks twice — once in the hero, once in the closing CTA
  // band (`dc.html:1880`, `:2211`) — and both call the design's same
  // `peekTrip`. They are two shells, not one, because `Preview` writes its id
  // to `data-preview-id` and the e2e spec locates by it: reusing one id would
  // match two nodes and trip Playwright's strict mode.
  "landing-see-finished": { milestone: "M11", wiredUpBy: "M11 share links — the same unauthenticated read, asked again in the closing CTA" },
} as const;

export type PreviewId = keyof typeof PREVIEW_REGISTRY;
export type PreviewMilestone = (typeof PREVIEW_REGISTRY)[PreviewId]["milestone"];
