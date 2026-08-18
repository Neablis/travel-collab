import type { PlaybookCard } from "./PlaybookCard";

// Sourced in spirit from the design handoff prototype's own `PLAYBOOKS`
// fixture (`~/Downloads/design_handoff_trip_planner/Trip Planner
// Redesign.dc.html`, the `PLAYBOOKS` array near the bottom) — six real
// entries reshaped into this task's own PlaybookCard type:
//   - `origin`/`originVariant` mirror the prototype's own origin Badge
//     ("Yours" -> brand, "From Priya" -> info, "From a link" -> neutral).
//   - `span` mirrors its computed `spanLine` (`days > 1 ? days + ' days ·
//     ' : ''` + `stops + ' stops · ' + span`).
//   - `shape` is the prototype's own bar-height-percent cycle, one entry
//     per stop.
//   - `preview`/`rawTimes` mirror its own `preview` ({t, n}) and `rawTimes`
//     (24h "HH:MM") arrays 1:1 — `rawTimes` feeds
//     trip/InsertPlaybookDialog.tsx's reflow calc, not this card.
//   - `meta` mirrors its footer `from + ' · ' + uses(used)` line.
export const PREVIEW_PLAYBOOK_CARDS: PlaybookCard[] = [
  {
    id: "pb1",
    city: "Kyoto",
    name: "Higashiyama at dawn",
    span: "1 day · 5 stops · 6:30 am – 2:15 pm",
    origin: "Yours",
    originVariant: "brand",
    tags: ["Temples", "Early start", "Walkable"],
    shape: [46, 72, 100, 58, 88],
    preview: [
      { time: "6:30 am", label: "Fushimi Inari before the crowds" },
      { time: "9 am", label: "% Arabica, Higashiyama" },
      { time: "10:30 am", label: "Kiyomizu-dera and Sannenzaka" },
    ],
    rawTimes: ["06:30", "09:00", "10:30"],
    meta: "From Japan · used 3 times",
  },
  {
    id: "pb2",
    city: "New Orleans",
    name: "Tremé food day",
    span: "1 day · 4 stops · 9 am – 11:45 pm",
    origin: "Yours",
    originVariant: "brand",
    tags: ["Food", "Live music"],
    shape: [46, 72, 100, 58],
    preview: [
      { time: "9 am", label: "Elizabeth's, Bywater" },
      { time: "1 pm", label: "Dooky Chase's" },
      { time: "9:45 pm", label: "Frenchmen Street" },
    ],
    rawTimes: ["09:00", "13:00", "21:45"],
    meta: "From New Orleans · used once",
  },
  {
    id: "pb3",
    city: "Tokyo",
    name: "Shibuya to Nakameguro on foot",
    span: "1 day · 6 stops · 8 am – 9 pm",
    origin: "From Priya",
    originVariant: "info",
    tags: ["Coffee", "Vintage", "Walkable"],
    shape: [46, 72, 100, 58, 88, 50],
    preview: [
      { time: "8 am", label: "Onibus Coffee" },
      { time: "11 am", label: "Daikanyama book shops" },
      { time: "7 pm", label: "Yakitori at Torishiki" },
    ],
    rawTimes: ["08:00", "11:00", "19:00"],
    meta: "Shared by Priya · used 12 times",
  },
  {
    id: "pb4",
    city: "Naoshima",
    name: "Naoshima in one day",
    span: "1 day · 5 stops · 7 am – 8:30 pm",
    origin: "From a link",
    originVariant: "neutral",
    tags: ["Art", "Ferry", "Timed tickets"],
    shape: [46, 72, 100, 58, 88],
    preview: [
      { time: "7 am", label: "Train and ferry from Osaka" },
      { time: "10:30 am", label: "Chichū Art Museum" },
      { time: "2:30 pm", label: "Benesse House" },
    ],
    rawTimes: ["07:00", "10:30", "14:30"],
    meta: "From Mei · used 2,400 times",
  },
  {
    id: "pb5",
    city: "Kyoto",
    name: "Arashiyama half day",
    span: "1 day · 4 stops · 9:45 am – 4:30 pm",
    origin: "Yours",
    originVariant: "brand",
    tags: ["Gardens", "Half day"],
    shape: [46, 72, 100, 58],
    preview: [
      { time: "9:45 am", label: "Bamboo grove and Tenryū-ji" },
      { time: "12:30 pm", label: "Lunch at Yoshida-ya" },
      { time: "3 pm", label: "Tea at Ippodo Kaboku" },
    ],
    rawTimes: ["09:45", "12:30", "15:00"],
    meta: "From Japan · used twice",
  },
  {
    id: "pb6",
    city: "Kyoto",
    name: "Kyoto in three days",
    span: "3 days · 15 stops · 6:30 am – 9:30 pm",
    origin: "Yours",
    originVariant: "brand",
    tags: ["Temples", "Food", "Gardens", "First time"],
    shape: [46, 72, 100, 58, 88, 50],
    preview: [
      { time: "Day 1 · 6:30 am", label: "Fushimi Inari, then Higashiyama" },
      { time: "Day 2 · 9:45 am", label: "Arashiyama and Tenryū-ji" },
      { time: "Day 3 · 9 am", label: "Ginkaku-ji and the Philosopher's Path" },
    ],
    rawTimes: ["06:30", "09:45", "09:00"],
    meta: "From Japan · used 6 times",
  },
];
