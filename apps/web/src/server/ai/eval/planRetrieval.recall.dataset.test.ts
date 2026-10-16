// The Gate 1 dataset's free guard (CI): the paid recall eval runs against a
// throwaway database, but its LABELS are authored against checked-in content,
// so this file re-derives every label from `content/playbooks/` and the Japan
// fixture and asserts it resolves to a real corpus row with a valid dayIndex.
// A renamed bundle key or a drifted fixture fails here, not as a mysterious
// recall drop in the paid run.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { playbookIdFor } from "@tc/fixtures";
import { JAPAN_TRIP_ID, RECALL_DATASET } from "./planRetrieval.recall.dataset";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every (bundleKey, playbookKey) in the checked-in corpus, with its authored day count. */
function corpusPlaybooks(): { sourceId: string; dayCount: number; bundleKey: string; playbookKey: string }[] {
  const dir = join(import.meta.dirname, "../../../../../../content/playbooks");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .flatMap((name) => {
      const doc = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
        bundle: { id: string };
        playbooks: { key: string; days?: { stops: unknown[] }[] }[];
      };
      return doc.playbooks.map((p) => ({
        sourceId: playbookIdFor(doc.bundle.id, p.key),
        dayCount: p.days?.length ?? 1,
        bundleKey: doc.bundle.id,
        playbookKey: p.key,
      }));
    });
}

const corpus = corpusPlaybooks();

describe("the Gate 1 recall dataset", () => {
  it("has 25 uniquely-identified, non-empty queries", () => {
    expect(RECALL_DATASET).toHaveLength(25);
    const ids = RECALL_DATASET.map((q) => q.id);
    expect(new Set(ids).size).toBe(25);
    expect(ids).toEqual([...ids].sort());
    const queries = RECALL_DATASET.map((q) => q.query);
    expect(new Set(queries).size).toBe(25);
    for (const q of RECALL_DATASET) expect(q.query.trim().length).toBeGreaterThan(0);
  });

  it("labels every query with 1–3 well-formed, distinct label tuples", () => {
    for (const q of RECALL_DATASET) {
      expect(q.labels.length).toBeGreaterThanOrEqual(1);
      expect(q.labels.length).toBeLessThanOrEqual(3);
      for (const label of q.labels) {
        expect(["playbook", "trip"]).toContain(label.sourceType);
        expect(label.sourceId).toMatch(UUID);
        expect(Number.isInteger(label.dayIndex)).toBe(true);
        expect(label.dayIndex).toBeGreaterThanOrEqual(0);
      }
      const keys = q.labels.map((l) => `${l.sourceType}:${l.sourceId}:${l.dayIndex}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("resolves every playbook label to a real corpus day", () => {
    const byId = new Map(corpus.map((p) => [p.sourceId, p]));
    for (const q of RECALL_DATASET) {
      for (const label of q.labels.filter((l) => l.sourceType === "playbook")) {
        const row = byId.get(label.sourceId);
        expect(row, `${q.id}: no corpus playbook with id ${label.sourceId}`).toBeDefined();
        expect(label.dayIndex).toBeLessThan(row!.dayCount);
      }
    }
  });

  it("resolves every trip label to a day of the seeded Japan trip", () => {
    // The eval seeds the Japan fixture trip (`japanTripCommands`, 14 days)
    // under JAPAN_TRIP_ID; labels name it with 0-based dayIndex.
    for (const q of RECALL_DATASET) {
      for (const label of q.labels.filter((l) => l.sourceType === "trip")) {
        expect(label.sourceId).toBe(JAPAN_TRIP_ID);
        expect(label.dayIndex).toBeLessThan(14);
      }
    }
  });

  it("covers the corpus it claims to: every labeled playbook is public", () => {
    // Recall runs as the eval actor, who sees public playbooks and their own
    // trip. A private playbook label would be invisible at k=5 and silently
    // cap that query's recall.
    const dir = join(import.meta.dirname, "../../../../../../content/playbooks");
    const visibilityById = new Map<string, string>();
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith("."))) {
      const doc = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
        bundle: { id: string };
        playbooks: { key: string; visibility: string }[];
      };
      for (const p of doc.playbooks) visibilityById.set(playbookIdFor(doc.bundle.id, p.key), p.visibility);
    }
    for (const q of RECALL_DATASET) {
      for (const label of q.labels.filter((l) => l.sourceType === "playbook")) {
        expect(visibilityById.get(label.sourceId), `${q.id}: labeled playbook is not public`).toBe("public");
      }
    }
  });
});
