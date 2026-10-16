// Name → id resolution for Gate 1 recall labels (RAG stack, Part 3).
//
// Labels name their chunks (`saved_days.name` for playbooks, the trip name
// for trips); this module resolves those names to database ids against
// whichever database the eval targets (fixture-seeded throwaway or
// production). FAILS LOUD on a missing or ambiguous name — a label that
// silently resolved to nothing would zero that query's recall and the gate
// would measure the dataset, not the retrieval.
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import type { RecallLabel } from "./planRetrieval.recall.dataset";

/** A label with its name resolved to the database id it names. */
export interface ResolvedLabel {
  sourceType: "playbook" | "trip";
  sourceId: string;
  dayIndex: number;
}

/**
 * Resolve every label's `sourceName` to the id it names. Returns the labels
 * grouped by query id. Throws listing every unresolvable name — never a
 * partial map.
 */
export async function resolveLabelIds(
  queries: { id: string; labels: RecallLabel[] }[],
): Promise<Map<string, ResolvedLabel[]>> {
  const byQuery = new Map<string, ResolvedLabel[]>();
  const unresolvable: string[] = [];
  for (const q of queries) {
    const resolved: ResolvedLabel[] = [];
    for (const label of q.labels) {
      let ids: string[];
      if (label.sourceType === "playbook") {
        const result = await db.execute<{ id: string }>(
          sql`SELECT id FROM saved_days WHERE name = ${label.sourceName}`,
        );
        ids = result.rows.map((r) => r.id);
      } else {
        const result = await db.execute<{ id: string }>(
          sql`SELECT trip_id AS id FROM trip_details WHERE doc->>'name' = ${label.sourceName}`,
        );
        ids = result.rows.map((r) => r.id);
      }
      if (ids.length === 0) {
        unresolvable.push(`${q.id}: no ${label.sourceType} named "${label.sourceName}"`);
      } else if (ids.length > 1) {
        unresolvable.push(
          `${q.id}: ambiguous ${label.sourceType} name "${label.sourceName}" ` +
            `(${ids.length} rows: ${ids.join(", ")})`,
        );
      } else {
        resolved.push({ sourceType: label.sourceType, sourceId: ids[0]!, dayIndex: label.dayIndex });
      }
    }
    byQuery.set(q.id, resolved);
  }
  if (unresolvable.length > 0) {
    throw new Error(
      `label resolution failed for ${unresolvable.length} label(s):\n` +
        unresolvable.map((u) => `  - ${u}`).join("\n") +
        `\nIn production mode this usually means the corpus doesn't contain the named ` +
        `playbook/trip (did the backfill cover it?), or the name differs. ` +
        `Resolve the names or drop the queries with RECALL_EVAL_ONLY.`,
    );
  }
  return byQuery;
}
