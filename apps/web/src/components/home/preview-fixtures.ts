import type { AttentionRow } from "./WorthYourAttention";
import type { PlaybookCard } from "./PlaybooksStrip";

// Sample data for Task 16's two home Preview shells.
//
// AttentionRow content is cross-trip advice a real assistant might surface
// on the home page (README §1 "Worth your attention" — not tied to any one
// trip's data, per the M10 plan notes on this task), rather than
// lorem-ipsum placeholders.
//
// PlaybookCard content is sourced in spirit from the design handoff
// prototype's own `PLAYBOOKS` fixture
// (`~/Downloads/design_handoff_trip_planner/Trip Planner Redesign.dc.html`),
// using its `playbooksShort`/`shapeOf` transform: `span` is the
// day-count-and-stop-count summary, `window` is the original start–end time
// range (`p.span` there), and `shape` is one bar-height percentage per stop
// (the prototype's own `shapeOf` height cycle, truncated to each card's
// stop count).
export const PREVIEW_ATTENTION: AttentionRow[] = [
  {
    id: "a1",
    title: "You haven't set a budget",
    body: "Add one so your trip stats can show what's left, not just what's spent.",
    cta: "Set budget",
  },
  {
    id: "a2",
    title: "3 activities still need times",
    body: "Untimed stops don't show up on the calendar view until they have one.",
    cta: "Review",
  },
  {
    id: "a3",
    title: "Two trips have no cover photo",
    body: "A photo makes a trip easier to pick out at a glance from the home page.",
    cta: "Add photos",
  },
];

export const PREVIEW_PLAYBOOKS: PlaybookCard[] = [
  {
    id: "p1",
    city: "Kyoto",
    name: "Higashiyama at dawn",
    span: "1 day · 5 stops",
    window: "6:30 am – 2:15 pm",
    shape: [46, 72, 100, 58, 88],
  },
  {
    id: "p2",
    city: "New Orleans",
    name: "Tremé food day",
    span: "1 day · 4 stops",
    window: "9 am – 11:45 pm",
    shape: [46, 72, 100, 58],
  },
  {
    id: "p3",
    city: "Tokyo",
    name: "Shibuya to Nakameguro on foot",
    span: "1 day · 6 stops",
    window: "8 am – 9 pm",
    shape: [46, 72, 100, 58, 88, 50],
  },
];
