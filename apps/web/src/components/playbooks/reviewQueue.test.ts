import { describe, expect, it } from "vitest";
import { clearHeldReview, holdReview, loadHeldReview, type HeldReview, type ReviewStorage } from "./reviewQueue";

const DAY = "aa000000-0000-4000-8000-000000000001";

function memoryStorage(): ReviewStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => void values.set(k, v),
    removeItem: (k) => void values.delete(k),
  };
}

const refusing: ReviewStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const held: HeldReview = { stars: 4, note: "Go early.", seenPublishedAt: "2026-09-01T00:00:00.000Z", heldAt: "2026-09-23T10:00:00.000Z" };

describe("the held-review store", () => {
  it("brings a held review back, and forgets it", () => {
    const storage = memoryStorage();
    expect(holdReview(DAY, held, storage)).toBe(true);
    expect(loadHeldReview(DAY, storage)).toEqual(held);
    clearHeldReview(DAY, storage);
    expect(loadHeldReview(DAY, storage)).toBeNull();
  });

  // "Did not know" and "saw it unpublished" ask the server different
  // questions, so a round trip must not collapse one into the other.
  it("keeps an unknown publish time distinct from a null one", () => {
    const storage = memoryStorage();
    holdReview(DAY, { stars: 3, note: null, heldAt: held.heldAt }, storage);
    expect(loadHeldReview(DAY, storage)).not.toHaveProperty("seenPublishedAt");
    holdReview(DAY, { stars: 3, note: null, seenPublishedAt: null, heldAt: held.heldAt }, storage);
    expect(loadHeldReview(DAY, storage)?.seenPublishedAt).toBeNull();
  });

  it("reads a value it cannot use as nothing held", () => {
    const storage = memoryStorage();
    storage.values.set(`held_review_v1:${DAY}`, JSON.stringify({ ...held, stars: 9 }));
    expect(loadHeldReview(DAY, storage)).toBeNull();
    storage.values.set(`held_review_v1:${DAY}`, "{not json");
    expect(loadHeldReview(DAY, storage)).toBeNull();
  });

  it("survives a browser that refuses storage, and says it could not hold", () => {
    expect(holdReview(DAY, held, refusing)).toBe(false);
    expect(loadHeldReview(DAY, refusing)).toBeNull();
    expect(() => clearHeldReview(DAY, refusing)).not.toThrow();
    expect(holdReview(DAY, held, null)).toBe(false);
  });
});
