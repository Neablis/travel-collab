import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_NOTE_MAX, SavedDayVisibility, type Review, type ReviewSummary, type SavedDayReviewsResponse } from "@tc/contracts";
import { scenarios } from "@tc/factories";
import { db } from "@/server/db/client";
import { savedDayReviews, savedDays } from "@/server/db/schema";
import { deleteSavedDay, saveDay, setSavedDayVisibility } from "@/server/savedDays";

// The reviews route (M12 links 1-3), walked as the people who use it: an author
// who publishes, a reader who rates, and nobody signed in. The counters' own
// agreement with the rows is `server/reviews.int.test.ts`; this file owns the
// status codes and what a client is handed back.
//
// Actors minted per test (KI-69), so every count below is exact.

let AUTHOR = "";
let READER = "";
let currentUserId: string | null = null;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET, PUT, DELETE } = await import("./route");

beforeEach(() => {
  AUTHOR = `m12-author-${randomUUID().slice(0, 8)}`;
  READER = `m12-reader-${randomUUID().slice(0, 8)}`;
  currentUserId = null;
});

afterEach(() => {
  vi.useRealTimers();
});

/** A one-day Playbook of AUTHOR's, from the factory's ordinary trip. Published unless told otherwise. */
async function authorsDay(visibility: SavedDayVisibility = "public"): Promise<string> {
  const detail = scenarios.threeDayTrip();
  const saved = await saveDay({ name: "Reviewed", dayIds: [detail.days[0]!.dayId] }, detail, AUTHOR);
  if (!saved.ok) throw new Error(saved.error.message);
  if (visibility === "public") await setSavedDayVisibility(saved.value.savedDayId, AUTHOR, "public");
  return saved.value.savedDayId;
}

const ctx = (savedDayId: string) => ({ params: Promise.resolve({ savedDayId }) });

const put = (savedDayId: string, body: unknown) =>
  PUT(new Request("http://test/x", { method: "PUT", body: JSON.stringify(body) }), ctx(savedDayId));

async function read(savedDayId: string): Promise<SavedDayReviewsResponse> {
  const res = await GET(new Request("http://test/x"), ctx(savedDayId));
  expect(res.status).toBe(200);
  return (await res.json()) as SavedDayReviewsResponse;
}

type Saved = { review: Review; summary: ReviewSummary };

describe("PUT /api/saved-days/:id/reviews", () => {
  it("rates a published day and hands back the recomputed summary", async () => {
    const id = await authorsDay();
    currentUserId = READER;

    const res = await put(id, { stars: 4, note: "Worth the early start." });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Saved;
    expect(body.review).toMatchObject({ reviewerId: READER, stars: 4, note: "Worth the early start.", isMine: true });
    expect(body.summary).toEqual({ average: 4, count: 1, histogram: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 } });
  });

  it("updates a second post rather than adding a row, and the average moves", async () => {
    const id = await authorsDay();
    currentUserId = READER;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-20T10:00:00.000Z"));
    const first = (await (await put(id, { stars: 5 })).json()) as Saved;
    vi.setSystemTime(new Date("2026-09-21T10:00:00.000Z"));
    const second = (await (await put(id, { stars: 2 })).json()) as Saved;

    expect(second.summary).toMatchObject({ average: 2, count: 1 });
    expect(second.review.createdAt).toBe(first.review.createdAt);
    expect(second.review.updatedAt).toBe("2026-09-21T10:00:00.000Z");
    const rows = await db.select().from(savedDayReviews).where(eq(savedDayReviews.savedDayId, id));
    expect(rows).toHaveLength(1);
  });

  it("refuses a note one character over the cap, and writes nothing", async () => {
    const id = await authorsDay();
    currentUserId = READER;

    expect((await put(id, { stars: 3, note: "x".repeat(REVIEW_NOTE_MAX + 1) })).status).toBe(400);
    expect((await read(id)).summary.count).toBe(0);
    // The cap itself is allowed — refused past it, not at it.
    expect((await put(id, { stars: 3, note: "x".repeat(REVIEW_NOTE_MAX) })).status).toBe(200);
  });

  it("refuses the author rating their own day", async () => {
    const id = await authorsDay();
    currentUserId = AUTHOR;

    const res = await put(id, { stars: 5 });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "own-day" });
  });

  it("404s a private, a deleted and a moderated day alike", async () => {
    const privateDay = await authorsDay("private");
    const deletedDay = await authorsDay("private");
    await deleteSavedDay(deletedDay, AUTHOR);
    const moderatedDay = await authorsDay();
    // Unit 3 owns the operator action; the column is what this route reads.
    await db.update(savedDays).set({ moderatedAt: new Date() }).where(eq(savedDays.id, moderatedDay));

    currentUserId = READER;
    for (const id of [privateDay, deletedDay, moderatedDay]) {
      expect((await put(id, { stars: 4 })).status, id).toBe(404);
    }
    // Even the author: reviewing a private day is not a thing, own or not.
    currentUserId = AUTHOR;
    expect((await put(privateDay, { stars: 4 })).status).toBe(404);
  });

  it("409s a review queued against a publish the author has since replaced", async () => {
    const id = await authorsDay();
    const [row] = await db.select().from(savedDays).where(eq(savedDays.id, id));
    const current = row!.publishedAt!.toISOString();
    currentUserId = READER;

    const stale = await put(id, { stars: 4, seenPublishedAt: "2026-01-01T00:00:00.000Z" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: "day-changed",
      changedAt: current,
      authorDisplayName: expect.any(String),
    });
    expect((await read(id)).summary.count).toBe(0);

    expect((await put(id, { stars: 4, seenPublishedAt: current })).status).toBe(200);
  });

  it("401s when nobody is signed in, on every method", async () => {
    const id = await authorsDay();
    expect((await put(id, { stars: 4 })).status).toBe(401);
    expect((await GET(new Request("http://test/x"), ctx(id))).status).toBe(401);
    expect((await DELETE(new Request("http://test/x", { method: "DELETE" }), ctx(id))).status).toBe(401);
  });
});

describe("GET and DELETE /api/saved-days/:id/reviews", () => {
  it("reads a review back on a later request, as the reviewer and as anyone else", async () => {
    const id = await authorsDay();
    currentUserId = READER;
    await put(id, { stars: 5, note: "Go early." });

    // A sign-out, a sign-in or a restart is a fresh request and nothing more:
    // the review is a row, so the next GET reads it back from the table.
    const mine = await read(id);
    expect(mine.mine).toMatchObject({ stars: 5, note: "Go early.", isMine: true });
    expect(mine.reviews).toHaveLength(1);

    currentUserId = AUTHOR;
    const theirs = await read(id);
    expect(theirs.mine).toBeNull();
    expect(theirs.reviews[0]).toMatchObject({ reviewerId: READER, isMine: false });
    expect(theirs.summary).toMatchObject({ average: 5, count: 1 });
  });

  it("withdraws the caller's own review, and 404s when there is none", async () => {
    const id = await authorsDay();
    currentUserId = READER;
    await put(id, { stars: 1 });

    const remove = () => DELETE(new Request("http://test/x", { method: "DELETE" }), ctx(id));
    const res = await remove();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { summary: ReviewSummary }).summary).toMatchObject({ average: null, count: 0 });
    expect((await remove()).status).toBe(404);
  });
});
