import type { Suggestion } from "./AssistantRail";

// Sample data for the M9 assistant-rail Preview shell (Task 14). Sourced in
// spirit from the design handoff prototype's own fixtures
// (`~/Downloads/design_handoff_trip_planner/Trip Planner Redesign.dc.html`,
// `suggestionData()`/`quickAsks` for the Japan trip) so the Preview reads as
// a real assistant surface rather than lorem-ipsum placeholders. M9 replaces
// these with the live suggestion/quick-ask source; the shape stays the same.

export const PREVIEW_CONTEXT_LINE = "Looking at all three of your trips";

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
