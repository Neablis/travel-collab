import { afterEach, describe, expect, it, vi } from "vitest";
import { deploymentOrigin } from "./deploymentOrigin";

// This function had no test, and the gap was not theoretical: preferring
// `VERCEL_URL` over the branch alias took every preview's operator console down
// with a 500, and it reached Mitchell's browser before it reached a test.
//
// The cases below are the four hosts this can resolve to, each pinned, because
// the defect was a PRECEDENCE bug — every individual branch worked, they were
// just consulted in the wrong order.
describe("deploymentOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function vercel(env: Record<string, string | undefined>) {
    // Every variable stubbed explicitly, including the absent ones: the real
    // process has a `VERCEL_URL` on any deployment, so a test that only sets
    // what it cares about would inherit the rest and prove nothing about order.
    for (const key of [
      "VERCEL_ENV",
      "VERCEL_PROJECT_PRODUCTION_URL",
      "VERCEL_BRANCH_URL",
      "VERCEL_URL",
      "WEB_PORT",
    ]) {
      vi.stubEnv(key, env[key]);
    }
  }

  it("uses the production domain in production", () => {
    vercel({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "caesura.today",
      VERCEL_BRANCH_URL: "tc-git-main-team.vercel.app",
      VERCEL_URL: "tc-abc123-team.vercel.app",
    });
    expect(deploymentOrigin()).toBe("https://caesura.today");
  });

  // **The regression.** A preview has both variables set, and the branch alias
  // is the host the browser used — so it is the host Deployment Protection
  // issued its cookie for, and the only one a forwarded cookie still matches.
  it("prefers the branch alias over the deployment url on a preview", () => {
    vercel({
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "tc-git-my-branch-team.vercel.app",
      VERCEL_URL: "tc-abc123-team.vercel.app",
    });
    expect(deploymentOrigin()).toBe("https://tc-git-my-branch-team.vercel.app");
  });

  // Production is decided by VERCEL_ENV, not by the production domain merely
  // being present — it is set on preview deployments too.
  it("does not use the production domain on a preview that knows it", () => {
    vercel({
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "caesura.today",
      VERCEL_BRANCH_URL: "tc-git-my-branch-team.vercel.app",
      VERCEL_URL: "tc-abc123-team.vercel.app",
    });
    expect(deploymentOrigin()).toBe("https://tc-git-my-branch-team.vercel.app");
  });

  it("falls back to the deployment url when there is no branch alias", () => {
    vercel({ VERCEL_ENV: "preview", VERCEL_URL: "tc-abc123-team.vercel.app" });
    expect(deploymentOrigin()).toBe("https://tc-abc123-team.vercel.app");
  });

  it("is localhost off Vercel, honouring WEB_PORT", () => {
    vercel({ WEB_PORT: "4000" });
    expect(deploymentOrigin()).toBe("http://localhost:4000");
  });

  it("defaults the local port to the one the dev server uses", () => {
    vercel({});
    expect(deploymentOrigin()).toBe("http://localhost:3001");
  });
});
