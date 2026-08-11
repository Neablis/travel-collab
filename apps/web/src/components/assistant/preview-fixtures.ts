import type { Suggestion } from "./AssistantRail";
import type { Proposal } from "./GhostProposal";

// Sample data for the still-Preview half of the assistant rail (Task 14;
// narrowed to just suggestions/quick-asks by the M10 redesign-feedback
// follow-up — the rail's ask box itself is real now, see AssistantRail.tsx).
// Sourced in spirit from the design handoff prototype's own fixtures
// (`~/Downloads/design_handoff_trip_planner/Trip Planner Redesign.dc.html`,
// `suggestionData()`/`quickAsks` for the Japan trip) so the Preview reads as
// a real assistant surface rather than lorem-ipsum placeholders. M9 replaces
// these with the live suggestion/quick-ask source; the shape stays the same.

export const PREVIEW_SUGGESTIONS: Suggestion[] = [
  {
    id: "j1",
    location: "Day 6 · Gora Kadan",
    title: "You arrive after check-in closes",
    body: "The ryokan stops check-in at 4 pm. The museum runs to 12:30 pm and the bus is 40 minutes, so a 4:40 pm arrival is late. Leaving at 2:30 pm fixes it.",
    cta: "Shift the day",
  },
  {
    id: "j2",
    location: "Day 10 · Kyoto",
    title: "Sunday has no dinner",
    body: "Three stops and nothing after 4 pm — the only night in Kyoto like that. Kikunoi Roan takes bookings 30 days out, which is next week.",
    cta: "Propose dinner",
  },
  {
    id: "j4",
    location: "Day 8 · Kyoto",
    title: "Day 8 is your best day so far",
    body: "Dawn to dinner, no doubling back, six stops. Save it as a Playbook — Dana asked for exactly this.",
    cta: "Save as Playbook",
  },
];

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
