// **Gate 1: offline recall@5 ≥ 0.7 for plan retrieval** (RAG stack, Part 3).
//
//   RECALL_EVAL_CONFIRM=1 pnpm --filter web eval -- planRetrieval.recall
//
// What it does: seeds the eval corpus (the 19 content bundles under
// `content/playbooks/` plus the 14-day Japan fixture trip) into the lane's
// throwaway Postgres, embeds every day-chunk through the REAL sweep
// (`runEmbedSweep`, the same function the cron route calls), then runs the 25
// labeled queries in `planRetrieval.recall.dataset.ts` through
// `embedText` → `retrieveDayChunks` and reports macro-averaged recall@5.
//
// **The userId decision.** The eval reads as a fixed actor (`eval-actor`, the
// same convention as `live.eval.ts`), NOT as logged-out null. Logged-out sees
// only public playbooks; the actor additionally sees the Japan trip it owns —
// and the trip's 14 food/museum/temple days are the corpus's richest multi-day
// content, the reason the dataset can label Tokyo/Kyoto/Osaka queries at all.
// All bundle playbooks are public, so the actor's corpus is the union: 148
// playbook days + 14 trip days = 162 chunks.
//
// **The money.** A run embeds the corpus once and the 25 queries once:
// 162 chunk embeds + 25 query embeds = 187 `embedText` calls on
// `openai/text-embedding-3-small` (short texts — a day's stops — so a few
// hundred thousand tokens total, cents at the published rate). Like the live
// lane, the run refuses to start without its key (`TRAVEL_COLLAB_EVAL_KEY`,
// required by `vitest.eval.config.ts` for the whole lane) and without
// `RECALL_EVAL_CONFIRM=1`, and it prints the plan first. A second run against
// a fresh throwaway database pays the full 187 again; nothing is cached
// between runs by design (each run measures the same cold-corpus path).
//
// **The verdict.** Macro-averaged recall@5 across the 25 queries. PASS ≥ 0.7
// (the stack resumes); FAIL < 0.7 (the stack STOPS — a failing expect exits
// non-zero, and the report still lands in `eval-results/`). A dead queue row
// or an unembeddable query fails the run rather than silently measuring a
// partial corpus: Gate 1 must report honestly, not optimistically.
//
// The free half of this gate — dataset invariants, label resolution against
// the checked-in content — is `planRetrieval.recall.dataset.test.ts` (CI).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { japanTripCommands, parseBundle, resolvePlaybook } from "@tc/fixtures";
import { executeTripCommand, executeTripCommandBatch } from "@/server/commands";
import { db } from "@/server/db/client";
import { savedDays } from "@/server/db/schema";
import { newSavedDayRow } from "@/server/savedDays";
import { recordAdd } from "@/server/savedDayAdds";
import { enqueueDayChunksForEmbedding } from "@/server/ai/queue";
import { runEmbedSweep } from "@/server/ai/sweep";
import { embedText } from "@/server/ai/embeddings";
import { retrieveDayChunks, type DayChunk } from "@/server/ai/retrieval";
import { JAPAN_TRIP_ID, RECALL_DATASET, type RecallLabel } from "./planRetrieval.recall.dataset";

const ACTOR_ID = "eval-actor";
// The bar. Below it the RAG stack stops; see the header.
const GATE = 0.7;
const K = 5;

const { upsertUser } = await import("@/server/users");
const { issueGrant } = await import("@/server/entitlements/grants");

const only = (process.env.RECALL_EVAL_ONLY ?? "").split(",").map((id) => id.trim()).filter(Boolean);
const confirmed = process.env.RECALL_EVAL_CONFIRM === "1";
const queries = RECALL_DATASET.filter((q) => only.length === 0 || only.includes(q.id));
const plan =
  `recall eval plan: ${queries.length} querie(s) x embed+retrieve@${K}, ` +
  `corpus ~162 day-chunks (148 bundle playbooks + 14 Japan trip days), ` +
  `≈187 paid embedding calls on openai/text-embedding-3-small`;

interface QueryRow {
  id: string;
  query: string;
  recall: number;
  hits: number;
  labeled: number;
  retrieved: { sourceType: string; sourceId: string; dayIndex: number; score: number }[];
  missed: RecallLabel[];
}

const rows: QueryRow[] = [];
let corpusChunks = 0;

const labelKey = (l: Pick<DayChunk, "sourceType" | "sourceId" | "dayIndex">) =>
  `${l.sourceType}:${l.sourceId}:${l.dayIndex}`;

/** The eval actor's grant, so the seeded trip is created by a real account. */
async function enrol(userId: string): Promise<void> {
  await upsertUser({ id: userId, email: null, name: null, image: null });
  await issueGrant({ userId, planId: "premium", planVersion: 1, source: "admin", grantedBy: "eval", expiresAt: null });
}

/**
 * The bundle playbooks, through the same server-side writers the content
 * importer uses (`newSavedDayRow` + `recordAdd` — the derivations happen here,
 * not in a second copy). Reviews, moderation and caches are skipped: the lane
 * database is throwaway-fresh, and retrieval reads `day_embeddings` directly.
 * Each day is enqueued for embedding through the real queue module.
 */
async function seedBundlePlaybooks(): Promise<number> {
  const dir = join(import.meta.dirname, "../../../../../../content/playbooks");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .sort();
  let days = 0;
  for (const file of files) {
    const bundle = parseBundle(JSON.parse(readFileSync(join(dir, file), "utf8")));
    const resolved = bundle.playbooks.map((p) => resolvePlaybook(bundle.bundle.id, p, bundle.bundle.origin));
    await db.transaction(async (tx) => {
      for (const day of resolved) {
        await tx.insert(savedDays).values(
          newSavedDayRow({
            savedDayId: day.savedDayId,
            ownerId: day.ownerId,
            name: day.name,
            summary: day.summary,
            stops: day.stops,
            dayCount: day.dayCount,
            visibility: day.visibility,
            authorKind: day.authorKind,
            sourceBundle: bundle.bundle.id,
            sourceTripId: day.sourceTripId,
            sourceTripName: day.sourceTripName,
            createdAt: day.keptOn === undefined ? new Date() : new Date(day.keptOn),
          }),
        );
        for (const add of day.addedBy) {
          await recordAdd(tx, {
            savedDayId: day.savedDayId,
            tripId: add.tripId,
            addedBy: add.addedBy,
            createdAt: day.keptOn === undefined ? new Date() : new Date(day.keptOn),
          });
        }
      }
    });
    for (const day of resolved) {
      await enqueueDayChunksForEmbedding(
        "playbook",
        day.savedDayId,
        Array.from({ length: day.dayCount }, (_, i) => i),
      );
      days += day.dayCount;
    }
  }
  return days;
}

/** The Japan fixture trip under the dataset's fixed id; its write hooks enqueue its 14 days. */
async function seedJapanTrip(): Promise<number> {
  const created = await executeTripCommand(
    { type: "CreateTrip", tripId: JAPAN_TRIP_ID, name: "Japan (recall eval)" },
    ACTOR_ID,
  );
  if (!created.ok) throw new Error(`seed: ${created.error.message}`);
  const seeded = await executeTripCommandBatch(
    japanTripCommands(JAPAN_TRIP_ID, { startDate: "2027-04-01" }),
    ACTOR_ID,
  );
  if (!seeded.ok) throw new Error(`seed: ${seeded.error.message}`);
  return seeded.detail.days.length;
}

/**
 * Embed the whole queue through the production sweep until it is drained. A
 * row the sweep cannot finish (dead-lettered) fails the run: recall measured
 * on a partial corpus would be the optimistic lie Gate 1 exists to prevent.
 */
async function embedCorpus(): Promise<void> {
  const queued = await db.execute<{ n: string }>(
    sql`SELECT count(*) AS n FROM pending_embeddings WHERE status = 'pending'`,
  );
  if (Number(queued.rows[0]?.n ?? 0) === 0) {
    throw new Error(
      "embed queue is empty after seeding — nothing would be embedded and recall would be " +
        "measured on an empty corpus. The enqueue is fail-open by design; check the logs above.",
    );
  }
  for (let pass = 1; pass <= 10; pass += 1) {
    const summary = await runEmbedSweep({ batchSize: 500 });
    console.log(
      `    sweep pass ${pass}: claimed ${summary.claimed}, embedded ${summary.embedded}, ` +
        `retried ${summary.retried}, dead ${summary.dead}, tombstoned ${summary.tombstoned}`,
    );
    if (summary.claimed === 0) break;
  }
  const status = await db.execute<{ status: string; n: string }>(
    sql`SELECT status, count(*) AS n FROM pending_embeddings GROUP BY status`,
  );
  const remaining = status.rows.filter((row) => row.status === "pending" || row.status === "processing");
  const dead = status.rows.filter((row) => row.status === "dead");
  if (dead.length > 0 || remaining.length > 0) {
    throw new Error(
      `embed queue did not drain: ${JSON.stringify(status.rows)}. ` +
        "A partially-embedded corpus would silently cap recall; fix the rows and re-run.",
    );
  }
}

beforeAll(async () => {
  console.log(plan);
  if (!confirmed) {
    throw new Error(`${plan}\nNothing was sent. Set RECALL_EVAL_CONFIRM=1 to spend it.`);
  }
  await enrol(ACTOR_ID);
});

afterAll(() => {
  if (rows.length === 0) {
    console.log("recall eval: no queries ran — no report written.");
    return;
  }
  const dir = join(import.meta.dirname, "../../../../eval-results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `recall-gate1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const macroRecall = rows.length === 0 ? 0 : rows.reduce((n, row) => n + row.recall, 0) / rows.length;
  const verdict = macroRecall >= GATE ? "PASS" : "FAIL";
  writeFileSync(
    file,
    `${JSON.stringify({ gate: GATE, k: K, corpusChunks, macroRecall, verdict, rows }, null, 2)}\n`,
  );
  console.log(
    [
      "",
      `recall eval: ${rows.length} queries, macro recall@${K} = ${macroRecall.toFixed(3)} — ${verdict} (bar ${GATE})`,
      ...rows.map(
        (row) =>
          `  ${row.recall >= GATE ? "✓" : "✗"} ${row.id}  recall@${K} ${row.recall.toFixed(2)} ` +
          `(${row.hits}/${row.labeled})  ${row.query}`,
      ),
      `report: ${file}`,
    ].join("\n"),
  );
});

describe("gate 1: offline recall@5", () => {
  // The corpus build (seeding + ~162 paid embeds) lives in the test, not
  // `beforeAll`: the lane's hook timeout is 120s and the embeds alone take
  // minutes. Ten minutes is the honest budget for ~187 embedding calls.
  it(
    `macro recall@${K} ≥ ${GATE} across ${queries.length} labeled queries`,
    { timeout: 600_000 },
    async () => {
      if (queries.length === 0) {
        throw new Error(`RECALL_EVAL_ONLY=${process.env.RECALL_EVAL_ONLY} matched no queries — refusing before spending.`);
      }
      const playbookDays = await seedBundlePlaybooks();
      const tripDays = await seedJapanTrip();
      corpusChunks = playbookDays + tripDays;
      console.log(
        `    seeded ${playbookDays} bundle playbook day(s) + ${tripDays} Japan trip day(s) = ${corpusChunks} chunks`,
      );
      await embedCorpus();

      for (const q of queries) {
        const queryEmbedding = await embedText(q.query);
        if (queryEmbedding === null) {
          throw new Error(`${q.id}: the query would not embed — scoring it 0 would be the optimistic lie; re-run.`);
        }
        const retrieved = await retrieveDayChunks({ queryEmbedding, queryText: q.query, userId: ACTOR_ID, k: K });
        const retrievedKeys = new Set(retrieved.map(labelKey));
        const hits = q.labels.filter((label) => retrievedKeys.has(labelKey(label)));
        const recall = q.labels.length === 0 ? 0 : hits.length / q.labels.length;
        rows.push({
          id: q.id,
          query: q.query,
          recall,
          hits: hits.length,
          labeled: q.labels.length,
          retrieved: retrieved.map((r) => ({
            sourceType: r.sourceType,
            sourceId: r.sourceId,
            dayIndex: r.dayIndex,
            score: r.score,
          })),
          missed: q.labels.filter((label) => !retrievedKeys.has(labelKey(label))),
        });
        console.log(`    ${q.id} recall@${K} ${recall.toFixed(2)} (${hits.length}/${q.labels.length}): ${q.query}`);
      }
      const macroRecall = rows.reduce((n, row) => n + row.recall, 0) / rows.length;
      // The gate: below 0.7 the stack STOPS. A failed expect exits non-zero, and
      // the report above still records exactly which queries missed.
      expect(macroRecall).toBeGreaterThanOrEqual(GATE);
    },
  );
});
