import type { PlaybookCard } from "./PlaybooksStrip";

// Sample data for the home "Your Playbooks" Preview shell. (PREVIEW_ATTENTION
// lived here too until PR #55 deleted "Worth your attention" on Mitchell's
// preview feedback that the designs had dropped it.)
//
// PlaybookCard content is sourced in spirit from the design handoff
// prototype's own `PLAYBOOKS` fixture
// (`~/Downloads/design_handoff_trip_planner/Trip Planner Redesign.dc.html`),
// using its `playbooksShort`/`shapeOf` transform: `span` is the
// day-count-and-stop-count summary, `window` is the original start–end time
// range (`p.span` there), and `shape` is one bar-height percentage per stop
// (the prototype's own `shapeOf` height cycle, truncated to each card's
// stop count).

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
