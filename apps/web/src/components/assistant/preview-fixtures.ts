import type { Proposal } from "./GhostProposal";

// Sample data for the still-Preview half of the assistant rail: just the
// quick-ask chips now. The rail's ask box is real (see AssistantRail.tsx),
// and the "What I noticed" suggestions this file also fed were deleted in
// PR #55 — the designs have no such block. Sourced in spirit from the design
// handoff prototype's own `quickAsks` for the Japan trip, so the Preview
// reads as a real assistant surface rather than lorem-ipsum placeholders. M9
// replaces these with the live source; the shape stays the same.


export const PREVIEW_QUICK_ASKS: string[] = [
  "Where am I overbooked?",
  "Find a rainy-day swap",
  "Cheapest way between cities",
];

// Sample data for Task 15's in-timeline ghost-proposal Preview shell — one
// plausible assistant-proposed stop for the same Japan-trip fixture context
// as the suggestions/quick-asks above, with a real start/end time window.
export const PREVIEW_GHOST_PROPOSAL: Proposal = {
  id: "g1",
  title: "Add teamLab Planets",
  why: "You have a free afternoon in Odaiba and it's a 20-minute train from your last stop.",
  start: "14:00",
  end: "16:00",
};
