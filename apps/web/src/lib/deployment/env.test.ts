import { afterEach, describe, expect, it, vi } from "vitest";
import { deployEnv, deploymentVersion, publicOrigin } from "./env";

// Every var either module reads is stubbed away first: a CI runner or a
// developer shell may carry a VERCEL_* of its own, and a case that only sets
// APP_ENV would then be testing the fallback.
const ALL = [
  "APP_ENV",
  "PUBLIC_ORIGIN",
  "APP_VERSION",
  "VERCEL_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_URL",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_GIT_COMMIT_SHA",
  "WEB_PORT",
];
function env(vars: Record<string, string>) {
  for (const name of ALL) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
}
afterEach(() => vi.unstubAllEnvs());

describe("deployEnv", () => {
  it("reads APP_ENV with no VERCEL_ENV set, which is how a self-hosted box answers", () => {
    env({ APP_ENV: "preview" });
    expect(deployEnv()).toBe("preview");
  });

  it("falls back to VERCEL_ENV when APP_ENV is absent", () => {
    env({ VERCEL_ENV: "production" });
    expect(deployEnv()).toBe("production");
  });

  it("lets APP_ENV win over VERCEL_ENV", () => {
    env({ APP_ENV: "preview", VERCEL_ENV: "production" });
    expect(deployEnv()).toBe("preview");
  });

  it("is undefined, not an empty string, when neither is set", () => {
    env({ VERCEL_ENV: "" });
    expect(deployEnv()).toBeUndefined();
  });
});

describe("publicOrigin", () => {
  it("prefers PUBLIC_ORIGIN, without a trailing slash", () => {
    env({ PUBLIC_ORIGIN: "https://caesura.today/", VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "x.vercel.app" });
    expect(publicOrigin()).toBe("https://caesura.today");
  });

  it("falls back to the Vercel production domain, then the branch alias, then the deployment URL", () => {
    env({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "caesura.today", VERCEL_BRANCH_URL: "b.vercel.app" });
    expect(publicOrigin()).toBe("https://caesura.today");
    env({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "b.vercel.app", VERCEL_URL: "d.vercel.app" });
    expect(publicOrigin()).toBe("https://b.vercel.app");
    env({ VERCEL_URL: "d.vercel.app" });
    expect(publicOrigin()).toBe("https://d.vercel.app");
  });

  it("is localhost on WEB_PORT, defaulting to 3001, with nothing set", () => {
    env({});
    expect(publicOrigin()).toBe("http://localhost:3001");
    env({ WEB_PORT: "4000" });
    expect(publicOrigin()).toBe("http://localhost:4000");
  });
});

describe("deploymentVersion", () => {
  it("prefers APP_VERSION, then the Vercel deployment id, then the commit sha, then local", () => {
    env({ APP_VERSION: "abc", VERCEL_DEPLOYMENT_ID: "dpl_1" });
    expect(deploymentVersion()).toBe("abc");
    env({ VERCEL_DEPLOYMENT_ID: "dpl_1", VERCEL_GIT_COMMIT_SHA: "sha" });
    expect(deploymentVersion()).toBe("dpl_1");
    env({ VERCEL_GIT_COMMIT_SHA: "sha" });
    expect(deploymentVersion()).toBe("sha");
    env({});
    expect(deploymentVersion()).toBe("local");
  });
});
