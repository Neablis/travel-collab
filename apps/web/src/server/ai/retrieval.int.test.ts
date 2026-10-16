import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { dayEmbeddings, tripMemberships } from "@/server/db/schema";
import { retrieveDayChunks } from "./retrieval";

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

  // fts the Part 2 way: built in SQL with the same dictionary the query uses.
  await db.execute(sql`UPDATE day_embeddings SET fts = to_tsvector('english', chunk_text)`);
});

afterAll(async () => {
  await db.delete(dayEmbeddings).where(inArray(dayEmbeddings.id, ids));
  await db.delete(tripMemberships).where(eq(tripMemberships.userId, READER));
});

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
      for (const id of [pubPlaybook, privMine, tripOwned, tripMember]) {
        expect(found).toContain(id);
      }
      expect(found).not.toContain(privOther);
      expect(found).not.toContain(tripStranger);
    });

    it("shows another user only public playbooks and their own private playbook", async () => {
      const found = await probe(OTHER);
      expect(found).toContain(pubPlaybook);
      expect(found).toContain(privOther);
      for (const id of [privMine, tripOwned, tripMember, tripStranger]) {
        expect(found).not.toContain(id);
      }
    });

    it("shows a logged-out reader public playbooks only", async () => {
      const found = await probe(null);
      expect(found).toContain(pubPlaybook);
      for (const id of [privMine, privOther, tripOwned, tripMember, tripStranger]) {
        expect(found).not.toContain(id);
      }
    });
  });
});
