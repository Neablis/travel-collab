import { afterEach, describe, expect, it, vi } from "vitest";

// `serverConfig` reads process.env once at module load, so every case stubs
// the env and re-imports — the same pattern as embeddings.test.ts.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function cronAuthWithEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./cronAuth");
}

const authed = (secret: string) => new Request("https://caesura.test/api/cron/embed-days", {
  headers: { authorization: `Bearer ${secret}` },
});

describe("isCronRequestAuthorized", () => {
  it("authorises the exact bearer secret", async () => {
    const { isCronRequestAuthorized } = await cronAuthWithEnv({ CRON_SECRET: "s3cr3t" });
    expect(isCronRequestAuthorized(authed("s3cr3t"))).toBe(true);
  });

  it("rejects a missing header", async () => {
    const { isCronRequestAuthorized } = await cronAuthWithEnv({ CRON_SECRET: "s3cr3t" });
    expect(isCronRequestAuthorized(new Request("https://caesura.test/api/cron/embed-days"))).toBe(false);
  });

  it("rejects a wrong secret", async () => {
    const { isCronRequestAuthorized } = await cronAuthWithEnv({ CRON_SECRET: "s3cr3t" });
    expect(isCronRequestAuthorized(authed("wrong"))).toBe(false);
  });

  it("rejects a malformed authorization scheme", async () => {
    const { isCronRequestAuthorized } = await cronAuthWithEnv({ CRON_SECRET: "s3cr3t" });
    const request = new Request("https://caesura.test/api/cron/embed-days", {
      headers: { authorization: "Token s3cr3t" },
    });
    expect(isCronRequestAuthorized(request)).toBe(false);
  });

  it("rejects everything when the secret is unset (fail closed)", async () => {
    // "" is what `process.env.CRON_SECRET ?? ""` produces when the var is
    // absent, so this is the unset case, not just the empty-string one.
    const { isCronRequestAuthorized } = await cronAuthWithEnv({ CRON_SECRET: "" });
    expect(isCronRequestAuthorized(authed("s3cr3t"))).toBe(false);
    expect(isCronRequestAuthorized(authed(""))).toBe(false);
  });
});
