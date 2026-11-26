import { randomUUID } from "node:crypto";
import { like } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client";
import { rateLimitCounters } from "../db/schema";
import { clientIp, limitLinkPreview, scheduleSweep } from "./limit";

// The link-preview limiter, and the counter sweep the other IP-keyed limiters
// share (CodeRabbit, PR 259: never twice at once on one instance). Against the
// real Postgres, so a row the limiter should not write would be seen.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const from = (ip: string) => new Request("http://test/x", { headers: { "x-forwarded-for": ip } });

describe("limitLinkPreview", () => {
  // 2026-11-17: every unfurl was an upsert, and Applebot's alone made a
  // database write a few times a minute. The limiter counts in memory now;
  // this pins that it still refuses, and that it wrote nothing doing it.
  it("refuses past the per-IP ceiling without writing a counter row", async () => {
    // Pinned mid-minute: the windows are epoch-aligned, see routes.int.test.ts.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-01-01T12:00:30.000Z"));
    vi.stubEnv("LINK_PREVIEW_RATE_LIMIT_PER_IP_MINUTE", "1");
    const ip = `ip-${randomUUID()}`;

    expect(await limitLinkPreview(from(ip))).toBeNull();
    const refused = await limitLinkPreview(from(ip));
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("Cache-Control")).toBe("no-store");

    const rows = await db
      .select({ bucket: rateLimitCounters.bucket })
      .from(rateLimitCounters)
      .where(like(rateLimitCounters.bucket, `%${ip}%`));
    expect(rows).toEqual([]);
  });
});

describe("clientIp", () => {
  it("is one bucket for a whole IPv6 /64, and one per IPv4 address", () => {
    expect(clientIp(from("2001:db8:1:2:aaaa::1"))).toBe(clientIp(from("2001:db8:1:2:bbbb:cccc:dddd:eeee")));
    expect(clientIp(from("2001:db8:1:2::1"))).not.toBe(clientIp(from("2001:db8:1:3::1")));
    expect(clientIp(from("2001:db8::1:2:3:4"))).toBe(clientIp(from("2001:db8:0:0:9::")));
    expect(clientIp(from("::ffff:198.51.100.7"))).toBe("198.51.100.7");
    // A proxy that spells the mapped address in hex still names one IPv4 client, not a shared bucket.
    expect(clientIp(from("::ffff:c633:6407"))).toBe("198.51.100.7");
    expect(clientIp(from("198.51.100.7"))).toBe("198.51.100.7");
    expect(clientIp(from("198.51.100.8"))).not.toBe(clientIp(from("198.51.100.7")));
  });
});

describe("scheduleSweep", () => {
  it("will not start a second sweep while one is in flight on this instance", async () => {
    let finish: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    let pending: Promise<void> = Promise.resolve();
    const defer = (task: () => Promise<void>) => {
      pending = task();
    };

    expect(scheduleSweep(run, defer)).toBe(true);
    expect(scheduleSweep(run, defer)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    finish();
    await pending;
    expect(scheduleSweep(run, defer)).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    finish();
    await pending;
  });

  it("frees the guard when a sweep fails", async () => {
    const pendings: Promise<void>[] = [];
    const defer = (task: () => Promise<void>) => {
      pendings.push(task());
    };

    expect(scheduleSweep(() => Promise.reject(new Error("deadlock")), defer)).toBe(true);
    await Promise.all(pendings);
    expect(scheduleSweep(() => Promise.resolve(), defer)).toBe(true);
    await Promise.all(pendings);
  });
});
