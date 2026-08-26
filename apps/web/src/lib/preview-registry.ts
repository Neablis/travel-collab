// The single seam listing every not-yet-functional surface. M9/M11 remove their
// entries as they wire each shell up. A sync test keeps this in lockstep with
// actual <Preview id> usage.
export const PREVIEW_REGISTRY = {
  "home-worth-attention": { milestone: "M9", wiredUpBy: "M9 proactive suggestions" },
  "home-playbooks-strip": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  // The rail's chrome (header/Hide) and ask box are real as of the M10
  // redesign-feedback follow-up — composeAiPlan, the same real M7 feature
  // the board's old ComposePanel used to expose directly. Only the
  // proactive half (suggestions the assistant notices on its own, and the
  // quick-ask nudge chips) is still M9/not-built — narrower Preview wraps
  // than the old single whole-rail "assistant-rail" entry this replaces.
  "assistant-suggestions": { milestone: "M9", wiredUpBy: "M9 proactive suggestions" },
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
  "trip-invites": { milestone: "M13", wiredUpBy: "Invites and non-owner roles — TripMember.role is literal \"owner\"" },
  "add-stop-suggestions": { milestone: "M9", wiredUpBy: "Grounded place search — nothing generates matches yet" },
  "add-stop-who": { milestone: "M13", wiredUpBy: "Per-stop attribution — no field records who a stop is for" },
  "wizard-destination-chips": { milestone: "M11", wiredUpBy: "No destination field on TripSummary/TripDetail to read recent-and-nearby from" },
  "wizard-playbook-panel": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  "wizard-longer-chip": { milestone: "M11", wiredUpBy: "Manual day-count entry beyond the four preset lengths — no UI for it yet" },
  "wizard-invite-list": { milestone: "M13", wiredUpBy: "Invites and non-owner roles — TripMember.role is literal \"owner\"" },
  "wizard-pace-tags": { milestone: "M9", wiredUpBy: "Pace and tags exist only to feed the assistant's draft" },
  "wizard-assistant-draft": { milestone: "M9", wiredUpBy: "M9 proactive drafting" },
  "landing-peek-trip": { milestone: "M11", wiredUpBy: "M11 share links — unauthenticated read of a real trip" },
} as const;

export type PreviewId = keyof typeof PREVIEW_REGISTRY;
export type PreviewMilestone = (typeof PREVIEW_REGISTRY)[PreviewId]["milestone"];
