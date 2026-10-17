import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import type { SavedStop } from "@tc/contracts";
import { dayEmbeddings, savedDays, tripMemberships } from "@/server/db/schema";
import { deleteSavedDay, setSavedDayVisibility, storeSavedDay } from "@/server/savedDays";
import { retrieveDayChunks, PUBLIC_LIBRARY_OWNER_ID } from "./retrieval";

// Hybrid retrieval against REAL pgvector (integration lane): the HNSW index,
// the `<=>` operator, the FTS dictionary and the RRF fusion are all database
// behaviour, so a mock would be the thing tested. Needs the pgvector
// extension — CI's service image is `pgvector/pgvector:pg17` for exactly
// this; the local dev DB gets `CREATE EXTENSION vector` by hand.

const DIMS = 1536;
const run = randomUUID().slice(0, 8);
const READER = `rag-reader-${run}`;
const OTHER = `rag-other-${run}`;
const STRANGER = `rag-stranger-${run}`;

const ids: string[] = [];
const playbookIds: string[] = [];

/** A 1536-dim vector with the first two components set, for exact distance control. */
const vec = (a: number, b = 0): number[] => {
  const v = new Array(DIMS).fill(0);
  v[0] = a;
  v[1] = b;
  return v;
};

/** One `day_embeddings` row; fts is built in SQL afterwards (Part 2's path). */
async function chunk(opts: {
  sourceType: "playbook" | "trip";
  sourceId: string;
  dayIndex?: number;
  chunkText: string;
  embedding?: number[] | null;
  visibility?: string;
  ownerId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(dayEmbeddings).values({
    id,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    dayIndex: opts.dayIndex ?? 0,
    chunkText: opts.chunkText,
    embedding: opts.embedding === undefined ? null : opts.embedding,
    fts: null,
    city: null,
    countryCode: null,
    tags: [],
    visibility: opts.visibility ?? "private",
    ownerId: opts.ownerId ?? null,
    createdAt: new Date(),
  });
  ids.push(id);
  return id;
}

const QUERY = "sushi ramen tokyo";
const QUERY_VEC = vec(1);

let both: string;
let denseOnly: string;
let sparseOnly: string;
let denseWeak: string;
let pubPlaybook: string;
let privMine: string;
let privOther: string;
let tripOwned: string;
let tripMember: string;
let tripStranger: string;
let libPlaybook: string;
let libTrip: string;

beforeAll(async () => {
  const playbook = randomUUID();
  // --- RRF fusion rows: owned by READER, public, so privacy never filters them.
  // "both" is the query vector itself (distance 0) and matches every term:
  // dense rank 1 AND sparse rank 1.
  both = await chunk({
    sourceType: "playbook",
    sourceId: playbook,
    chunkText: "sushi ramen tokyo sushi ramen tokyo food day",
    embedding: QUERY_VEC,
    visibility: "public",
    ownerId: READER,
  });
  // Dense rank 2 (a hair off the query), but its text matches nothing:
  // retrievable ONLY through the dense leg.
  denseOnly = await chunk({
    sourceType: "playbook",
    sourceId: playbook,
    dayIndex: 1,
    chunkText: "desert hiking camels night sky",
    embedding: vec(1, 0.01),
    visibility: "public",
    ownerId: READER,
  });
  // No embedding at all (the `embedding IS NOT NULL` guard drops it from the
  // dense leg), but its text matches: retrievable ONLY through the sparse leg.
  sparseOnly = await chunk({
    sourceType: "playbook",
    sourceId: playbook,
    dayIndex: 2,
    chunkText: "sushi ramen tokyo izakaya guide",
    embedding: null,
    visibility: "public",
    ownerId: READER,
  });
  // Dense rank 3: further from the query than denseOnly (rank 2), and its
  // text matches nothing. Proves the rank inside a leg matters, not just
  // which leg found the chunk — distances are exact, unlike ts_rank's
  // position hair-splitting, so this ordering is not fragile.
  denseWeak = await chunk({
    sourceType: "playbook",
    sourceId: playbook,
    dayIndex: 3,
    chunkText: "alpine lakes quiet cabins",
    embedding: vec(1, 0.5),
    visibility: "public",
    ownerId: READER,
  });

  // --- Privacy matrix rows: null embeddings (dense leg ignores them) and a
  // shared probe word in fts, so a second query finds exactly these rows.
  const probe = (who: string) => `privacyprobe ${who} quiet meadow`;
  pubPlaybook = await chunk({
    sourceType: "playbook",
    sourceId: randomUUID(),
    chunkText: probe("public"),
    visibility: "public",
    ownerId: OTHER,
  });
  privMine = await chunk({
    sourceType: "playbook",
    sourceId: randomUUID(),
    chunkText: probe("mine"),
    visibility: "private",
    ownerId: READER,
  });
  privOther = await chunk({
    sourceType: "playbook",
    sourceId: randomUUID(),
    chunkText: probe("theirs"),
    visibility: "private",
    ownerId: OTHER,
  });
  // The owner has no trip_memberships row (see schema.ts): owner_id is the
  // only thing that can let them see their own trip's days back.
  const ownedTrip = randomUUID();
  tripOwned = await chunk({
    sourceType: "trip",
    sourceId: ownedTrip,
    chunkText: probe("ownedtrip"),
    ownerId: READER,
  });
  const memberTrip = randomUUID();
  // Owned by a third party: OTHER is neither owner nor member, so this
  // trip's days must stay invisible to them (the membership row below is
  // for READER only).
  tripMember = await chunk({
    sourceType: "trip",
    sourceId: memberTrip,
    chunkText: probe("membertrip"),
    ownerId: STRANGER,
  });
  await db.insert(tripMemberships).values({
    tripId: memberTrip,
    userId: READER,
    role: "viewer",
    invitedBy: STRANGER,
    createdAt: new Date().toISOString(),
  });
  tripStranger = await chunk({
    sourceType: "trip",
    sourceId: randomUUID(),
    chunkText: probe("strangertrip"),
    ownerId: STRANGER,
  });
  // Seeded sample content: owned by the public-library system account, so it
  // is visible to everyone (including logged-out), like a public playbook.
  // The playbook is deliberately private: visibility must not be doing the
  // work here, the owner rule must.
  libPlaybook = await chunk({
    sourceType: "playbook",
    sourceId: randomUUID(),
    chunkText: probe("libraryplaybook"),
    visibility: "private",
    ownerId: PUBLIC_LIBRARY_OWNER_ID,
  });
  libTrip = await chunk({
    sourceType: "trip",
    sourceId: randomUUID(),
    chunkText: probe("librarytrip"),
    ownerId: PUBLIC_LIBRARY_OWNER_ID,
  });

  // fts the Part 2 way: built in SQL with the same dictionary the query uses.
  await db.execute(sql`UPDATE day_embeddings SET fts = to_tsvector('english', chunk_text)`);
});

afterAll(async () => {
  await db.delete(dayEmbeddings).where(inArray(dayEmbeddings.id, ids));
  await db.delete(tripMemberships).where(eq(tripMemberships.userId, READER));
  if (playbookIds.length > 0) await db.delete(savedDays).where(inArray(savedDays.id, playbookIds));
});

/** A real `saved_days` row, so the source's live state is what the query can read. */
async function livePlaybook(ownerId: string): Promise<string> {
  const stop: SavedStop = {
    title: "Withdrawal probe stop",
    timeWindow: null,
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    dayIndex: 0,
    mode: null,
    endLocation: null,
    pendingReason: null,
  };
  const saved = await storeSavedDay({
    ownerId,
    name: "Withdrawal probe",
    stops: [stop],
    dayCount: 1,
    sourceTripId: randomUUID(),
    sourceTripName: "retrieval.int.test",
    now: new Date().toISOString(),
    context: { route: "retrieval.int.test" },
  });
  if (!saved.ok) throw new Error("storeSavedDay failed in test setup");
  playbookIds.push(saved.value.savedDayId);
  return saved.value.savedDayId;
}

describe("retrieveDayChunks", () => {
  it("fuses dense and sparse with RRF: both-legs first, then by leg rank", async () => {
    const chunks = await retrieveDayChunks({
      queryEmbedding: QUERY_VEC,
      queryText: QUERY,
      userId: READER,
      k: 4,
    });
    // The RRF claim, exactly: a chunk found by both legs (2/61) outranks a
    // chunk found by one (1/62). denseOnly and sparseOnly tie — the honest
    // math, same rank in different legs — so their relative order is the
    // id tiebreak and only the set is asserted. denseWeak at dense rank 3
    // (1/63) proves the rank inside a leg matters, not just which leg.
    expect(chunks).toHaveLength(4);
    const [c0, c1, c2, c3] = chunks;
    expect(c0?.id).toBe(both);
    expect(c0?.score).toBeCloseTo(2 / 61, 5);
    expect(new Set([c1?.id, c2?.id])).toEqual(new Set([denseOnly, sparseOnly]));
    expect(c1?.score).toBeCloseTo(1 / 62, 5);
    expect(c2?.score).toBeCloseTo(1 / 62, 5);
    expect(c3?.id).toBe(denseWeak);
    expect(c3?.score).toBeCloseTo(1 / 63, 5);
  });

  it("returns DayChunks with the documented shape", async () => {
    const [top] = await retrieveDayChunks({
      queryEmbedding: QUERY_VEC,
      queryText: QUERY,
      userId: READER,
      k: 1,
    });
    expect(top).toBeDefined();
    expect(top).toMatchObject({
      id: both,
      sourceType: "playbook",
      chunkText: expect.stringContaining("sushi"),
      tags: [],
    });
    expect(typeof top?.score).toBe("number");
  });

  it("stays total on an empty query text", async () => {
    const chunks = await retrieveDayChunks({
      queryEmbedding: QUERY_VEC,
      queryText: "",
      userId: READER,
      k: 2,
    });
    // Sparse leg matches nothing; dense leg still answers.
    expect(chunks.map((c) => c.id)).toEqual([both, denseOnly]);
  });

  describe("privacy filter", () => {
    const probe = (userId: string | null) =>
      retrieveDayChunks({ queryEmbedding: QUERY_VEC, queryText: "privacyprobe", userId, k: 20 }).then(
        (chunks) => chunks.map((c) => c.id),
      );

    it("shows the reader their own private playbook, public playbooks, and trips they own or belong to", async () => {
      const found = await probe(READER);
      for (const id of [pubPlaybook, privMine, tripOwned, tripMember, libPlaybook, libTrip]) {
        expect(found).toContain(id);
      }
      expect(found).not.toContain(privOther);
      expect(found).not.toContain(tripStranger);
    });

    it("shows another user only public playbooks and their own private playbook", async () => {
      const found = await probe(OTHER);
      expect(found).toContain(pubPlaybook);
      expect(found).toContain(privOther);
      expect(found).toContain(libPlaybook);
      expect(found).toContain(libTrip);
      for (const id of [privMine, tripOwned, tripMember, tripStranger]) {
        expect(found).not.toContain(id);
      }
    });

    it("shows a logged-out reader public playbooks only", async () => {
      const found = await probe(null);
      expect(found).toContain(pubPlaybook);
      expect(found).toContain(libPlaybook);
      expect(found).toContain(libTrip);
      for (const id of [privMine, privOther, tripOwned, tripMember, tripStranger]) {
        expect(found).not.toContain(id);
      }
    });

    it("treats service-ai-library content as public for a stranger with no relationship to it", async () => {
      // The literal is pinned: the privacy filter interpolates this exact
      // string, so a rename must be a deliberate, reviewed change — not a
      // silent constant edit that keeps the tests green while production
      // behavior changes.
      expect(PUBLIC_LIBRARY_OWNER_ID).toBe("service-ai-library");
      const found = await probe(STRANGER);
      expect(found).toContain(libPlaybook);
      expect(found).toContain(libTrip);
      // And the stranger's own trip stays theirs alone.
      expect(found).toContain(tripStranger);
      expect(found).not.toContain(privMine);
    });
  });

  // The embedding row's `visibility` is a copy taken at embed time, refreshed
  // only when the sweep next re-embeds the day — a day later on the daily
  // cron. These rows are embedded while their playbook is visible and then
  // withdrawn with NO sweep in between: the source's live state must decide.
  describe("a playbook withdrawn after it was embedded", () => {
    const find = (word: string, userId: string | null) =>
      retrieveDayChunks({ queryEmbedding: QUERY_VEC, queryText: word, userId, k: 20 }).then((chunks) =>
        chunks.map((c) => c.id),
      );

    it("is never served to anyone else once unpublished, and still to its owner", async () => {
      const playbook = await livePlaybook(OTHER);
      expect(await setSavedDayVisibility(playbook, OTHER, "public")).not.toBeNull();
      const embedded = await chunk({
        sourceType: "playbook",
        sourceId: playbook,
        chunkText: "unpublishprobe quiet meadow",
        visibility: "public",
        ownerId: OTHER,
      });
      await db.execute(sql`UPDATE day_embeddings SET fts = to_tsvector('english', chunk_text) WHERE id = ${embedded}`);
      expect(await find("unpublishprobe", READER)).toContain(embedded);

      expect(await setSavedDayVisibility(playbook, OTHER, "private")).not.toBeNull();

      expect(await find("unpublishprobe", READER)).not.toContain(embedded);
      expect(await find("unpublishprobe", null)).not.toContain(embedded);
      expect(await find("unpublishprobe", OTHER)).toContain(embedded);
    });

    it("is never served again once deleted, not even to its owner", async () => {
      const playbook = await livePlaybook(OTHER);
      const embedded = await chunk({
        sourceType: "playbook",
        sourceId: playbook,
        chunkText: "deleteprobe quiet meadow",
        visibility: "private",
        ownerId: OTHER,
      });
      await db.execute(sql`UPDATE day_embeddings SET fts = to_tsvector('english', chunk_text) WHERE id = ${embedded}`);
      expect(await find("deleteprobe", OTHER)).toContain(embedded);

      expect(await deleteSavedDay(playbook, OTHER)).toBe("deleted");

      expect(await find("deleteprobe", OTHER)).not.toContain(embedded);
    });
  });
});
