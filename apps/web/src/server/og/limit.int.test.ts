import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, limitLinkPreview, scheduleSweep } from "./limit";

// When the link-preview limiter may start a counter sweep (CodeRabbit, PR
// #259): only behind an allowed request, and never twice at once on one
// instance. Against the real Postgres counter.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const from = (ip: string) => new Request("http://test/x", { headers: { "x-forwarded-for": ip } });

describe("limitLinkPreview", () => {
  it("offers a sweep for an allowed request and never for a refused one", async () => {
    // Pinned mid-minute: the windows are epoch-aligned, see routes.int.test.ts.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-01-01T12:00:30.000Z"));
    vi.stubEnv("LINK_PREVIEW_RATE_LIMIT_PER_IP_MINUTE", "1");
    const ip = `ip-${randomUUID()}`;
    const onAllowed = vi.fn();

    expect(await limitLinkPreview(from(ip), onAllowed)).toBeNull();
    expect(onAllowed).toHaveBeenCalledTimes(1);

    const refused = await limitLinkPreview(from(ip), onAllowed);
    expect(refused?.status).toBe(429);
    expect(onAllowed).toHaveBeenCalledTimes(1);
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
