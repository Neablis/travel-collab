import { afterEach, describe, expect, it } from "vitest";
import { isDemoDataResetEnabled } from "./demoDataReset";

// The gate POST /api/dev/reset-demo-data and AppHeader both check (see
// AGENTS.md invariant: contracts/permission checks fail closed). Exercised
// on its own so the boolean logic is proven independent of the route's
// plumbing — the route's own int test then only needs one closed/open case
// each, not every combination.
describe("isDemoDataResetEnabled", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("is false with neither env var set", () => {
    delete process.env.VERCEL_ENV;
    delete process.env.SEED_DEMO_DATA;
    expect(isDemoDataResetEnabled()).toBe(false);
  });

  it("is false on production even with SEED_DEMO_DATA=true", () => {
    process.env.VERCEL_ENV = "production";
    process.env.SEED_DEMO_DATA = "true";
    expect(isDemoDataResetEnabled()).toBe(false);
  });

  it("is false on preview without SEED_DEMO_DATA set", () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.SEED_DEMO_DATA;
    expect(isDemoDataResetEnabled()).toBe(false);
  });

  it("is false on preview with a near-miss SEED_DEMO_DATA value", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.SEED_DEMO_DATA = "TRUE";
    expect(isDemoDataResetEnabled()).toBe(false);
  });

  it("is true only on preview with SEED_DEMO_DATA=true", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.SEED_DEMO_DATA = "true";
    expect(isDemoDataResetEnabled()).toBe(true);
  });
});
