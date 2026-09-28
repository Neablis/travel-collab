import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryClient } from "./memory";

// The in-process driver (ADR-059). It exists to behave like Upstash on a
// laptop, so each test here is a way the two could differ.

afterEach(() => {
  vi.useRealTimers();
});

describe("createMemoryClient", () => {
  it("forgets a key once its TTL has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
    const client = createMemoryClient();
    await client.set("k", { firstName: "Dana" }, { ex: 60 });

    vi.advanceTimersByTime(59_000);
    expect(await client.get("k")).toEqual({ firstName: "Dana" });
    vi.advanceTimersByTime(1_000);
    expect(await client.get("k")).toBeNull();
  });

  it("decodes what it stores the way @upstash/redis does, so a bare \"123\" comes back a number", async () => {
    const client = createMemoryClient();
    await client.set("bare", "123", { ex: 60 });
    await client.set("wrapped", { firstName: "123" }, { ex: 60 });
    await client.set("name", "Dana", { ex: 60 });

    expect(await client.get("bare")).toBe(123);
    expect(await client.get("wrapped")).toEqual({ firstName: "123" });
    expect(await client.get("name")).toBe("Dana");
  });

  it("holds at most maxEntries keys, evicting the oldest write", async () => {
    const client = createMemoryClient(2);
    await client.set("a", 1, { ex: 60 });
    await client.set("b", 2, { ex: 60 });
    await client.set("a", 1, { ex: 60 }); // rewritten, so now newer than b
    await client.set("c", 3, { ex: 60 });

    expect(await client.get("b")).toBeNull();
    expect(await client.get("a")).toBe(1);
    expect(await client.get("c")).toBe(3);
  });

  it("deletes a key", async () => {
    const client = createMemoryClient();
    await client.set("k", { v: 1 }, { ex: 60 });
    await client.del("k");

    expect(await client.get("k")).toBeNull();
  });
});
