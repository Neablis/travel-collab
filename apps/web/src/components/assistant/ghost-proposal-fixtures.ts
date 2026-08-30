import type { Proposal } from "./GhostProposal";

// Sample data for Task 15's in-timeline ghost-proposal Preview shell — one
// plausible assistant-proposed stop for the Japan-trip fixture context, with
// a real start/end time window. Split out of the former preview-fixtures.ts
// (M16 Wave 1, Task 4) when that file's other export — PREVIEW_QUICK_ASKS —
// was deleted along with the rail's quick-ask chip row; "timeline-ghost" is a
// separate, still-unbuilt M9 surface this task does not touch. M9 replaces
// this with the live source; the shape stays the same.
export const PREVIEW_GHOST_PROPOSAL: Proposal = {
  id: "g1",
  title: "Add teamLab Planets",
  why: "You have a free afternoon in Odaiba and it's a 20-minute train from your last stop.",
  start: "14:00",
  end: "16:00",
};
