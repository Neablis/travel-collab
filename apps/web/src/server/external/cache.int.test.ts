import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { db } from "@/server/db/client";
import { externalDataCache } from "@/server/db/schema";
import { pgCacheStore, readThrough, type ReadThrough } from "./cache";
import { UpstreamError, type CacheValidators, type Fetched } from "./upstream";

// ADR-052 decision 2's read path against real Postgres (decision 9's "cache
// integration test"): fresh → no call; expired → conditional call; a 304 keeps
// the payload; a failure serves the stale row with its old as-of; a 429 backs
// the key off; a quota refusal calls nothing. The port is a stub — no test
// reaches a real host.

const Value = z.object({ asOf: z.string(), n: z.number() });
type Value = z.infer<typeof Value>;

const T0 = new Date("2026-09-24T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const KEY = "met:forecast:59.91,10.75";

beforeEach(async () => {
  // Only this table; each run has its own database (with-test-db.mjs).
  await db.delete(externalDataCache);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function harness(call: (prior?: CacheValidators) => Promise<Fetched<Value>>, over: Partial<ReadThrough<Value>> = {}) {
  const port = vi.fn(call);
  const charge = vi.fn(async () => true);
  const read = (now: Date) =>
    readThrough<Value>({ key: KEY, schema: Value, call: port, charge, store: pgCacheStore(), now, timeoutMs: 200, ...over });
  return { port, charge, read };
}

const fresh = (value: Value, expiresAt: Date): Fetched<Value> => ({
  kind: "fresh", value, expiresAt, lastModified: "Thu, 24 Sep 2026 09:00:00 GMT", sourceUpdatedAt: new Date(value.asOf),
});
const rowOf = async () => (await db.select().from(externalDataCache))[0];

describe("external_data_cache read-through", () => {
  it("a miss calls, charges once, and stores the normalized value keyed by point", async () => {
    const { port, charge, read } = harness(async () => fresh({ asOf: "2026-09-24T08:00:00Z", n: 1 }, minutes(30)));
    expect(await read(T0)).toEqual({ value: { asOf: "2026-09-24T08:00:00Z", n: 1 }, stale: false });
    expect(port).toHaveBeenCalledOnce();
    expect(port.mock.calls[0]![0]).toBeUndefined();
    expect(charge).toHaveBeenCalledOnce();
    expect(await rowOf()).toMatchObject({
      key: KEY, payload: { asOf: "2026-09-24T08:00:00Z", n: 1 }, expiresAt: minutes(30),
      lastModified: "Thu, 24 Sep 2026 09:00:00 GMT", sourceUpdatedAt: new Date("2026-09-24T08:00:00Z"),
    });
  });

  it("a fresh row is served with no call and no charge", async () => {
    const { port, charge, read } = harness(async () => fresh({ asOf: "2026-09-24T08:00:00Z", n: 1 }, minutes(30)));
    await read(T0);
    port.mockClear();
    charge.mockClear();
    expect(await read(minutes(29))).toEqual({ value: { asOf: "2026-09-24T08:00:00Z", n: 1 }, stale: false });
    expect(port).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("an expired row is revalidated with If-Modified-Since, and a 304 keeps the payload with the new Expires", async () => {
    const first = harness(async () => fresh({ asOf: "2026-09-24T08:00:00Z", n: 1 }, minutes(30)));
    await first.read(T0);
    const second = harness(async () => ({ kind: "not-modified", expiresAt: minutes(90), lastModified: null }));
    expect(await second.read(minutes(31))).toEqual({ value: { asOf: "2026-09-24T08:00:00Z", n: 1 }, stale: false });
    expect(second.port).toHaveBeenCalledWith({ lastModified: "Thu, 24 Sep 2026 09:00:00 GMT" });
    expect(await rowOf()).toMatchObject({ payload: { n: 1 }, expiresAt: minutes(90), lastModified: "Thu, 24 Sep 2026 09:00:00 GMT" });
  });

  it("a failed call serves the expired row, with its own older as-of", async () => {
    await harness(async () => fresh({ asOf: "2026-09-24T08:00:00Z", n: 1 }, minutes(30))).read(T0);
    const down = harness(async () => Promise.reject(new Error("socket hang up")));
    expect(await down.read(minutes(45))).toEqual({ value: { asOf: "2026-09-24T08:00:00Z", n: 1 }, stale: true });
    // A failure with no status says nothing about when to come back, so the
    // row is not touched: the next request tries again.
    expect(await rowOf()).toMatchObject({ expiresAt: minutes(30), backoffUntil: null });
  });

  // ADR-052 decision 8: a 403 is OUR request being wrong, and asking again
  // cannot fix it; a 5xx is the source down. Retried on every page load, each
  // was charged to the shared daily quota until nothing — normals included —
  // could be asked (M14 PART 3 review, finding 3).
  it.each([
    ["a 403 for a day", 403, 24 * 60],
    ["a 5xx for five minutes", 503, 5],
  ])("backs the key off after %s, calling and charging nothing until it passes", async (_label, status, backoff) => {
    await harness(async () => fresh({ asOf: "2026-09-24T08:00:00Z", n: 1 }, minutes(30))).read(T0);
    const refused = harness(async () => Promise.reject(new UpstreamError(`MET Norway: ${status}`, status)));
    expect(await refused.read(minutes(45))).toEqual({ value: { asOf: "2026-09-24T08:00:00Z", n: 1 }, stale: true });
    expect(await rowOf()).toMatchObject({ payload: { n: 1 }, backoffUntil: minutes(45 + backoff) });

    const again = harness(async () => fresh({ asOf: "2026-09-24T09:40:00Z", n: 2 }, minutes(120)));
    expect(await again.read(minutes(45 + backoff - 1))).toEqual({ value: { asOf: "2026-09-24T08:00:00Z", n: 1 }, stale: true });
    expect(again.port).not.toHaveBeenCalled();
    expect(again.charge).not.toHaveBeenCalled();
    expect(await again.read(minutes(45 + backoff + 1))).toMatchObject({ value: { n: 2 }, stale: false });
  });

  it("a call slower than the timeout is a failure, and serves the stale row", async () => {
    await harness(async () => fresh({ asOf: "2026-09-24T08:00:00Z", n: 1 }, minutes(30))).read(T0);
    const slow = harness(() => new Promise<Fetched<Value>>(() => {}), { timeoutMs: 20 });
    expect(await slow.read(minutes(45))).toEqual({ value: { asOf: "2026-09-24T08:00:00Z", n: 1 }, stale: true });
  });

  it("with no row, a failure answers nothing", async () => {
    const down = harness(async () => Promise.reject(new Error("socket hang up")));
    expect(await down.read(T0)).toBeNull();
    expect(await rowOf()).toBeUndefined();
  });

  it("a 429 backs the key off — even one that never held anything — and no call is made until it passes", async () => {
    const limited = harness(async () => Promise.reject(new UpstreamError("MET Norway: 429", 429, minutes(10))));
    expect(await limited.read(T0)).toBeNull();
    expect(await rowOf()).toMatchObject({ payload: null, backoffUntil: minutes(10) });

    const next = harness(async () => fresh({ asOf: "2026-09-24T09:05:00Z", n: 2 }, minutes(60)));
    expect(await next.read(minutes(5))).toBeNull();
    expect(next.port).not.toHaveBeenCalled();
    expect(await next.read(minutes(11))).toEqual({ value: { asOf: "2026-09-24T09:05:00Z", n: 2 }, stale: false });
    expect(await rowOf()).toMatchObject({ backoffUntil: null });
  });

  it("a quota refusal calls nothing, and serves what it has", async () => {
    await harness(async () => fresh({ asOf: "2026-09-24T08:00:00Z", n: 1 }, minutes(30))).read(T0);
    const refused = harness(async () => fresh({ asOf: "2026-09-24T09:40:00Z", n: 2 }, minutes(90)), {
      charge: async () => false,
    });
    expect(await refused.read(minutes(40))).toEqual({ value: { asOf: "2026-09-24T08:00:00Z", n: 1 }, stale: true });
    expect(refused.port).not.toHaveBeenCalled();
  });

  it("a stored payload that no longer fits the schema is treated as absent", async () => {
    await db.insert(externalDataCache).values({
      key: KEY, payload: { shape: "from an older build" }, fetchedAt: T0, expiresAt: minutes(60),
      lastModified: "Thu, 24 Sep 2026 09:00:00 GMT", sourceUpdatedAt: null, backoffUntil: null,
    });
    const { port, read } = harness(async () => fresh({ asOf: "2026-09-24T09:00:00Z", n: 3 }, minutes(60)));
    expect(await read(minutes(1))).toEqual({ value: { asOf: "2026-09-24T09:00:00Z", n: 3 }, stale: false });
    // Not conditional: a 304 would leave nothing that parses to serve.
    expect(port.mock.calls[0]![0]).toBeUndefined();
  });
});
