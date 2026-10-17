// The Gate 1 dataset's free guard (CI): the paid recall eval runs against a
// database (fixture-seeded throwaway, or production in `RECALL_EVAL_PRODUCTION=1`
// mode), but its LABELS are authored against checked-in content, so this file
// re-derives every label name from `content/playbooks/` and the Japan fixture
// and asserts it names a real corpus row. A renamed playbook fails here, not
// as a mysterious recall drop in the paid run.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JAPAN_TRIP_NAME, RECALL_DATASET } from "./planRetrieval.recall.dataset";

/** Every playbook name in the checked-in corpus, with its bundle key and visibility. */
function corpusPlaybooks(): { name: string; bundleKey: string; playbookKey: string; visibility: string; dayCount: number }[] {
  const dir = join(import.meta.dirname, "../../../../../../content/playbooks");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .flatMap((name) => {
      const doc = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
        bundle: { id: string };
        playbooks: { key: string; name: string; visibility: string; days?: { stops: unknown[] }[] }[];
      };
      return doc.playbooks.map((p) => ({
        name: p.name,
        bundleKey: doc.bundle.id,
        playbookKey: p.key,
        visibility: p.visibility,
        dayCount: p.days?.length ?? 1,
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
        expect(typeof label.sourceName).toBe("string");
        expect(label.sourceName.trim().length).toBeGreaterThan(0);
        expect(Number.isInteger(label.dayIndex)).toBe(true);
        expect(label.dayIndex).toBeGreaterThanOrEqual(0);
      }
      const keys = q.labels.map((l) => `${l.sourceType}:${l.sourceName}:${l.dayIndex}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("resolves every playbook label to a real corpus playbook name", () => {
    const byName = new Map(corpus.map((p) => [p.name, p]));
    // Names must be unique in the corpus or the eval's runtime resolution
    // would be ambiguous.
    expect(byName.size).toBe(corpus.length);
    for (const q of RECALL_DATASET) {
      for (const label of q.labels.filter((l) => l.sourceType === "playbook")) {
        const row = byName.get(label.sourceName);
        expect(row, `${q.id}: no corpus playbook named "${label.sourceName}"`).toBeDefined();
        expect(label.dayIndex).toBeLessThan(row!.dayCount);
      }
    }
  });

  it("resolves every trip label to the Japan fixture trip's name", () => {
    // The eval seeds the Japan fixture trip (`japanTripCommands`, 14 days)
    // under JAPAN_TRIP_NAME in fixture mode; production mode resolves the
    // same name against the live database (fail loud if absent).
    for (const q of RECALL_DATASET) {
      for (const label of q.labels.filter((l) => l.sourceType === "trip")) {
        expect(label.sourceName).toBe(JAPAN_TRIP_NAME);
        expect(label.dayIndex).toBeLessThan(14);
      }
    }
  });

  it("covers the corpus it claims to: every labeled playbook is public", () => {
    // Recall runs as the eval actor, who sees public playbooks and their own
    // trip. A private playbook label would be invisible at k=5 and silently
    // cap that query's recall.
    const visibilityByName = new Map(corpus.map((p) => [p.name, p.visibility]));
    for (const q of RECALL_DATASET) {
      for (const label of q.labels.filter((l) => l.sourceType === "playbook")) {
        expect(visibilityByName.get(label.sourceName), `${q.id}: labeled playbook "${label.sourceName}" is not public`).toBe(
          "public",
        );
      }
    }
  });
});
