import { afterEach, describe, expect, it, vi } from "vitest";

// The container healthcheck (Dockerfile) and Coolify's rollout both ask this
// URL, so it must answer without a session and without touching the database.
// A database import that throws at load would fail this file the same way it
// would fail the check, which is the point of importing the handler cold.
vi.mock("@/server/db/client", () => {
  throw new Error("the health route must not load the database");
});

import { GET, dynamic } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health", () => {
  it("answers 200 {ok:true} without a session and without the database", async () => {
    vi.stubEnv("SOURCE_COMMIT", "abc123");
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  // The preview check waits until this equals the PR head sha, so a stale
  // build from the previous push cannot be mistaken for the head.
  it("reports the build's commit sha as version, from Coolify's SOURCE_COMMIT", async () => {
    vi.stubEnv("SOURCE_COMMIT", "0123456789abcdef");
    expect((await GET().json()).version).toBe("0123456789abcdef");
  });

  it("reports version 'unknown' when no commit is known", async () => {
    vi.stubEnv("SOURCE_COMMIT", undefined);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    expect((await GET().json()).version).toBe("unknown");
  });

  it("is never prerendered, or `next build` would freeze the answer", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
