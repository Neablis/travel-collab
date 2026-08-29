// The single seam listing every not-yet-functional surface. M9/M11 remove their
// entries as they wire each shell up. A sync test keeps this in lockstep with
// actual <Preview id> usage.
// M11 link 3 removed "trip-invites" (SettingsSheet's mocked invite row — now
// the real TravelersPanel) and "wizard-invite-list" (the wizard's mocked
// "You / Owner" list — now a sentence pointing at Trip settings, because the
// wizard runs before the trip an invite would attach to exists).
//
// M11 link 4 removed "share-button" (now a real popover that mints, copies and
// turns off pinned links) and both landing shells, "landing-peek-trip" and
// "landing-see-finished" (now two ordinary links to `/s/featured`).
//
// M11 link 6 removed "keep-day-flag" and "keep-day-dialog" (the pennant now
// saves a real day into a real library) and "add-saved-day" — which also
// empties `preview-registry.test.ts`'s PARKED escape hatch, since the file
// that parked it is rendered now.
export const PREVIEW_REGISTRY = {
  "home-playbooks-strip": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  // The rail's chrome (header/Hide) and ask box are real as of the M10
  // redesign-feedback follow-up — composeAiPlan, the same real M7 feature
  // the board's old ComposePanel used to expose directly. The quick-ask
  // nudge chips ("assistant-quick-asks") were deleted rather than left
  // shelved in M16 Wave 1 (Task 4, SPEC §9's docked presentation) — Task 5
  // reintroduces them as derived suggested questions computed from real trip
  // state, not a wired-up copy of this same Preview shell.
  //
  // "assistant-suggestions" (the "What I noticed" shelf) was deleted rather
  // than left shelved — Mitchell, preview feedback on PR #55: the design's
  // panel has no such block, only the conversation and the ask box. Nothing
  // to wire up in M9 because there is nothing there to wire.
  "timeline-ghost": { milestone: "M9", wiredUpBy: "M9 propose→review→approve" },
  "playbooks-route": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  "insert-playbook": { milestone: "M11", wiredUpBy: "M11 insert-a-Playbook" },
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
} as const;

export type PreviewId = keyof typeof PREVIEW_REGISTRY;
export type PreviewMilestone = (typeof PREVIEW_REGISTRY)[PreviewId]["milestone"];
