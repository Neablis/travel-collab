// Gate 2's query set: 10 diverse plan queries for the plan-retrieval RAG
// stack's quality-and-cost eval (Part 5).
//
// **Why 10, and why these.** M48's brief says "over 10 prompts" — 10 is the
// agreed reading (the brief's intent was "about ten", not "eleven or more").
// These are a diverse subset of Gate 1's 25 labeled queries (PR #461,
// `planRetrieval.recall.dataset.ts` on the `sunny/rag-part3-gate1` branch),
// chosen to cover: food-focused, culture/museum, outdoors/hiking, beach,
// city-classics, and multi-destination. Each had strong Gate 1 recall, so a
// quality failure can't be blamed on "no examples found".
//
// The queries are the eval's ONLY input. Labels are not needed — Gate 2
// measures output tokens and judged quality, not recall.

/** One Gate 2 query. */
export interface Gate2Query {
  /** Stable id, `g2-01` … `g2-10`. */
  id: string;
  /** The plan request, sent to the model verbatim. */
  query: string;
  /** Why this query is in the set (coverage note). */
  intent: string;
}

/** The 10 Gate 2 queries. */
export const GATE2_DATASET: Gate2Query[] = [
  {
    id: "g2-01",
    query: "plan a 6-day food trip to Tokyo",
    intent: "Food-first, single city. Gate 1 recall 1.00 — examples are strong.",
  },
  {
    id: "g2-02",
    query: "3 days in Paris focused on museums",
    intent: "Culture/museum, single city. Tests example adaptation across cities.",
  },
  {
    id: "g2-03",
    query: "long weekend hiking in the Alps, big views, no car",
    intent: "Outdoors, no-car constraint. Tests constraint handling with examples.",
  },
  {
    id: "g2-04",
    query: "wine tasting weekend near San Francisco",
    intent: "Food/drink, regional. Short trip — examples should compress well.",
  },
  {
    id: "g2-05",
    query: "2 days in Rome, first visit, the classics done right",
    intent: "City classics. Canonical itinerary — examples should match closely.",
  },
  {
    id: "g2-06",
    query: "slow family beach week in Thailand with a 5-year-old, no boats if possible",
    intent: "Family, constraints (kid, no boats). Tests constraint + example blending.",
  },
  {
    id: "g2-07",
    query: "street food crawl in Mexico City",
    intent: "Food, single city, different region. Tests cross-region example use.",
  },
  {
    id: "g2-08",
    query: "Utah and Arizona national parks road trip, the big ones",
    intent: "Multi-destination outdoors. Long trip — token savings should show.",
  },
  {
    id: "g2-09",
    query: "2 days in Marrakech, medina and food",
    intent: "Culture + food, short. Tests example density on brief trips.",
  },
  {
    id: "g2-10",
    query: "Bali: temples at dawn and beach clubs after",
    intent: "Mixed theme (culture + leisure). Tests thematic example matching.",
  },
];
