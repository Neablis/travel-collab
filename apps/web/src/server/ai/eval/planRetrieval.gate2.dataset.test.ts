// Free (CI) invariants for Gate 2's dataset: the 10 queries are well-formed,
// unique, and diverse. The paid eval itself (`planRetrieval.gate2.eval.ts`)
// never runs in CI.
import { describe, expect, it } from "vitest";
import { GATE2_DATASET } from "./planRetrieval.gate2.dataset";

describe("gate 2 dataset", () => {
  it("has exactly 10 queries", () => {
    expect(GATE2_DATASET).toHaveLength(10);
  });

  it("has unique ids of the form g2-NN", () => {
    const ids = GATE2_DATASET.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^g2-\d{2}$/);
    }
  });

  it("every query is non-empty and carries an intent note", () => {
    for (const q of GATE2_DATASET) {
      expect(q.query.trim().length).toBeGreaterThan(10);
      expect(q.intent.trim().length).toBeGreaterThan(0);
    }
  });

  it("queries are unique (no duplicates)", () => {
    const queries = GATE2_DATASET.map((q) => q.query.toLowerCase().trim());
    expect(new Set(queries).size).toBe(queries.length);
  });
});
