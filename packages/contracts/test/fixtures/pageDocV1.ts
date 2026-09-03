// The v1 golden document (ADR-038 decision 5): one real page exercising every
// node type that exists at v1, stored exactly as a v1 row is stored — with no
// `v` field, because no v1 row has one.
//
// This file is frozen the day a v2 fixture sits beside it, and not before: it
// grew on 2026-09-03 when v1's vocabulary was widened to what `PageEditor`'s
// `StarterKit` has been able to emit all along (lists, blockquote, code block,
// horizontal rule, hard break, headings 4-6). A golden that omits half of the
// version it is the golden FOR is not a guard. After v2, this one stays exactly
// as it is forever — that is the mechanism that stops v6 from breaking v2's
// documents.
//
// Every shape below was copied from a real `editor.getJSON()`, not written from
// the ADR: `attrs: { start, type }` on `orderedList`, `attrs: { language }` on
// `codeBlock`, and no `attrs` key at all on `horizontalRule`/`hardBreak`.
//
// Typed `unknown` on purpose — a golden fixture that is typed by the schema it
// is meant to catch drift in cannot catch drift in it.
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
    // Levels 4-6 are reachable from the editor and from `/ask`; the AST said
    // 1-3 until 2026-09-03, which made this heading a hard parse error.
    { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "Small print" }] },
    // A list whose second item nests another list — the depth at which a
    // serialiser that walks only one level starts losing things.
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Passport" }] }] },
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Money" }] },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "budget " },
                        { type: "macro", attrs: { name: "cost.trip", params: {} } },
                      ],
                    },
                    // Two levels of list down, beside a widget: the deepest
                    // point at which decision 3 has to still be true, and the
                    // one a serialiser that walks a single level gets wrong.
                    { type: "checklist", attrs: { done: false }, content: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3, type: null },
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Third, then." }] }] },
      ],
    },
    {
      type: "blockquote",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Nothing is ever booked until it is paid for." }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "even this one" }] },
                // A node from a newer build, four levels down. Decision 3 has
                // to hold here too, or the nesting is where it quietly stops.
                { type: "poll", attrs: { question: "ryokan or hotel?" }, content: [] },
              ],
            },
          ],
        },
      ],
    },
    { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const nights = 4;" }] },
    { type: "horizontalRule" },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Depart 09:40" },
        { type: "hardBreak" },
        { type: "text", text: "Arrive 12:15" },
      ],
    },
    // A node written by a build newer than this one. A v1 row can contain one
    // the day after a deploy, and it has to survive being read by this build.
    { type: "timeline", attrs: { zoom: "week" }, content: [{ type: "text", text: "held verbatim" }] },
  ],
};
