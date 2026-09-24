// The pure half of `Idempotency-Key` (ADR-051): what a body hashes to, and what
// a stored reservation means for the request in front of it. The database half
// — the insert that is the lock, the takeover, the release — is driven for real
// in `idempotency.int.test.ts`.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { witness } from "@/test-support/witness";

// Nothing here queries; the store's functions are not called in this file.
vi.mock("@/server/db/client", () => ({ db: {} }));

const {
  canonicalJson,
  decideKey,
  IDEMPOTENCY_LEASE_MS,
  IDEMPOTENCY_TTL_MS,
  readIdempotencyKey,
  requestHash,
} = await import("./idempotency");

/** The same object with its keys, at every depth, in reverse order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]));
}

/** Whether any object in `value` has two keys to put in a different order. */
function reorderable(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(reorderable);
  if (value === null || typeof value !== "object") return false;
  const entries = Object.values(value);
  return entries.length >= 2 || entries.some(reorderable);
}

describe("canonicalJson", () => {
  it("hashes a body the same whatever order its keys arrived in, for every JSON value", () => {
    const w = witness("canonical key order");
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        // Only an object with two or more keys somewhere can be reordered; a
        // scalar passes by being a scalar.
        if (reorderable(value)) w.tick();
        expect(requestHash(reversed(value))).toBe(requestHash(value));
        // And it is still the same value, not merely a stable string.
        expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
    w.atLeast(15); // observed 31-43 of 100 runs with a reorderable object, over 12 runs
  });

  it("tells different bodies apart", () => {
    expect(requestHash({ playbookId: "a" })).not.toBe(requestHash({ playbookId: "b" }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 1, b: 2 }));
    expect(requestHash([1, 2])).not.toBe(requestHash([2, 1]));
  });

  it("drops undefined properties, as the JSON on the wire would", () => {
    expect(canonicalJson({ b: 1, a: undefined })).toBe('{"b":1}');
  });
});

describe("readIdempotencyKey", () => {
  const h = (value?: string) => new Headers(value === undefined ? {} : { "Idempotency-Key": value });

  it("takes an absent header as no key, and 1..255 characters as one", () => {
    expect(readIdempotencyKey(h())).toEqual({ key: null });
    expect(readIdempotencyKey(h("k"))).toEqual({ key: "k" });
    expect(readIdempotencyKey(h("x".repeat(255)))).toEqual({ key: "x".repeat(255) });
  });

  it("refuses a key over 255 characters", () => {
    expect(readIdempotencyKey(h("x".repeat(256)))).toHaveProperty("refused");
  });
});

describe("decideKey", () => {
  const T0 = new Date("2026-09-24T12:00:00.000Z");
  const at = (ms: number) => new Date(T0.getTime() + ms);
  const same = { method: "POST", path: "/api/v1/trips/t/playbook-applications", requestHash: "h1" };
  const done = { ...same, statusCode: 201, response: { ok: 1 }, createdAt: T0, completedAt: at(10) };
  const running = { ...same, statusCode: null, response: null, createdAt: T0, completedAt: null };

  it("replays a finished request's status and body", () => {
    expect(decideKey(done, same, at(1000))).toEqual({ kind: "replay", status: 201, body: { ok: 1 } });
  });

  it("refuses the key for a different body, path or method — finished or not", () => {
    for (const row of [done, running]) {
      expect(decideKey(row, { ...same, requestHash: "h2" }, at(1000))).toEqual({ kind: "mismatch" });
      expect(decideKey(row, { ...same, path: "/elsewhere" }, at(1000))).toEqual({ kind: "mismatch" });
      expect(decideKey(row, { ...same, method: "PATCH" }, at(1000))).toEqual({ kind: "mismatch" });
    }
  });

  it("says in flight inside the lease, and lets an abandoned reservation be taken over after it", () => {
    expect(decideKey(running, same, at(IDEMPOTENCY_LEASE_MS - 1))).toEqual({ kind: "in-flight" });
    expect(decideKey(running, same, at(IDEMPOTENCY_LEASE_MS))).toEqual({ kind: "reclaim" });
  });

  it("treats a row 24 hours old as absent, whatever request it was for", () => {
    expect(decideKey(done, same, at(IDEMPOTENCY_TTL_MS - 1))).toMatchObject({ kind: "replay" });
    expect(decideKey(done, same, at(IDEMPOTENCY_TTL_MS))).toEqual({ kind: "reclaim" });
    expect(decideKey(done, { ...same, requestHash: "h2" }, at(IDEMPOTENCY_TTL_MS))).toEqual({ kind: "reclaim" });
  });
});
