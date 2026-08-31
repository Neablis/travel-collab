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
//
// M11b removed the four PLAYBOOKS shells — "home-playbooks-strip",
// "playbooks-route", "insert-playbook" and "wizard-playbook-panel" — deleted
// rather than re-pointed, along with the mock fixtures and the two components
// that existed only to hold them.
//
// **The five leftover M11 entries were retagged on 2026-08-31, by Mitchell.**
// "rack-provenance", "cost-estimate-state", "budget-breakdown",
// "wizard-destination-chips" and "wizard-longer-chip" were tagged M11 and are
// not Playbooks — each is blocked on a contract field that does not exist, so
// they were mis-tagged rather than owed, and M11b's "no M11-tagged entry
// remains" was false for reasons M11b could not fix. Where each went:
//
//   * `rack-provenance` -> **M13**, which already holds `add-stop-who` for the
//     same missing per-stop attribution field.
//   * `cost-estimate-state` and `budget-breakdown` -> **M19**, minted for them
//     the same day (`docs/milestones/M19-cost-model.md`). No existing milestone
//     owned cost classification; M4 closed long ago.
//   * The two wizard shells -> **"unplaced"**, deliberately. No milestone will
//     wire them, and tagging them to one that merely sounds adjacent would move
//     the false claim rather than remove it. `unplaced` is the honest value and
//     nothing validates the field's format.
//
// The rule this follows: a shell's milestone tag is a claim that that milestone
// will wire it up. Retag when the claim stops being true; do not retag to make
// a gate box pass.
export const PREVIEW_REGISTRY = {
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
  "map-legend-modes": { milestone: "M9", wiredUpBy: "Transport mode per leg — no field models it today" },
  "rack-provenance": { milestone: "M13", wiredUpBy: "Who parked a stop, and which day it came from — no field models either. Sits with `add-stop-who`, the same absence from the other side; whichever milestone lands per-stop attribution unblocks both" },
  "cost-estimate-state": { milestone: "M19", wiredUpBy: "Confirmed-vs-estimate flag per cost — no field models it" },
  "budget-breakdown": { milestone: "M19", wiredUpBy: "Booked/Holds/Travel/Other categories — no field classifies a cost" },
  "add-stop-suggestions": { milestone: "M9", wiredUpBy: "Grounded place search — nothing generates matches yet" },
  "add-stop-who": { milestone: "M13", wiredUpBy: "Per-stop attribution — no field records who a stop is for" },
  "wizard-destination-chips": { milestone: "unplaced", wiredUpBy: "No destination field on TripSummary/TripDetail to read recent-and-nearby from — and no milestone owns adding one. `unplaced` rather than a guess: see the note above the registry" },
  "wizard-longer-chip": { milestone: "unplaced", wiredUpBy: "Manual day-count entry beyond the four preset lengths. NOT blocked on a field — the only shell here that is purely unbuilt UI, so any milestone could take it" },
  "wizard-pace-tags": { milestone: "M9", wiredUpBy: "Pace and tags exist only to feed the assistant's draft" },
  "wizard-assistant-draft": { milestone: "M9", wiredUpBy: "M9 proactive drafting" },
} as const;

export type PreviewId = keyof typeof PREVIEW_REGISTRY;
export type PreviewMilestone = (typeof PREVIEW_REGISTRY)[PreviewId]["milestone"];
