// The v1 golden document (ADR-038 decision 5): one real page exercising every
// node type that exists at v1, stored exactly as a v1 row is stored — with no
// `v` field, because no v1 row has one.
//
// This file never changes. When v2 lands it gets a sibling and this one stays,
// which is the whole mechanism: it is what stops v6 from breaking v2's
// documents. Typed `unknown` on purpose — a golden fixture that is typed by the
// schema it is meant to catch drift in cannot catch drift in it.
export const PAGE_DOC_V1_GOLDEN: unknown = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Kyoto" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Total so far: " },
        { type: "macro", attrs: { name: "cost.trip", params: {} } },
        { type: "text", text: " (rough)", marks: [{ type: "italic" }] },
      ],
    },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Day 3" }] },
    { type: "macro", attrs: { name: "itinerary.day", params: { day: { kind: "index", index: 2 } } } },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Notes" }] },
    { type: "paragraph", content: [{ type: "text", text: "Book the ryokan.", marks: [{ type: "bold" }] }] },
    { type: "paragraph" },
    {
      type: "repeat",
      attrs: { name: "day.line", params: { day: { kind: "index", index: 0 } } },
      content: [{ type: "text", text: "· " }, { type: "macro", attrs: { name: "cost.day", params: {} } }],
    },
    // A node written by a build newer than this one. A v1 row can contain one
    // the day after a deploy, and it has to survive being read by this build.
    { type: "timeline", attrs: { zoom: "week" }, content: [{ type: "text", text: "held verbatim" }] },
  ],
};
