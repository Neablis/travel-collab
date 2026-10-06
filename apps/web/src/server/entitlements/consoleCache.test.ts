import { afterEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
// Records the key and options each read is cached under, and reads through.
const unstable_cache = vi.fn((read: () => Promise<unknown>, _keyParts: string[], _options: unknown) => read);
vi.mock("next/cache", () => ({ revalidateTag, unstable_cache }));
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag: vi.fn(), waitUntil: vi.fn() }));

const { CONSOLE_CACHE_SECONDS, CONSOLE_TAG, consoleCached, invalidateConsole } = await import("./consoleCache");

afterEach(() => {
  vi.unstubAllEnvs();
  unstable_cache.mockClear();
  revalidateTag.mockReset();
});

// The Users tab navigates on every click; the trailing read behind it is the
// same for all of them, so production keeps it — and only production.
describe("consoleCached", () => {
  it("keeps a read for five minutes under the console's tag, keyed by deployment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_one");

    expect(await consoleCached(["shared-reads"], async () => 42)).toBe(42);

    const [, key, options] = unstable_cache.mock.lastCall!;
    expect(key[0]).toBe("admin-console");
    expect(key).toContain("dpl_one");
    expect(key.at(-1)).toBe("shared-reads");
    expect(options).toEqual({ revalidate: CONSOLE_CACHE_SECONDS, tags: [CONSOLE_TAG] });
    expect(CONSOLE_CACHE_SECONDS).toBe(300);
  });

  it("reads live outside a production build", async () => {
    vi.stubEnv("NODE_ENV", "test");

    expect(await consoleCached(["shared-reads"], async () => 7)).toBe(7);
    expect(unstable_cache).not.toHaveBeenCalled();
  });
});

// An operator's own grant or revoke moves who holds what; they should see it
// on the next page, not five minutes later.
describe("invalidateConsole", () => {
  it("expires the console's entries at once", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await invalidateConsole();

    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith(CONSOLE_TAG, { expire: 0 });
  });

  it("never throws: the write it follows has already committed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("no store");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(invalidateConsole()).resolves.toBeUndefined();
  });
});
