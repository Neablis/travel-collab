import { describe, expect, it, vi } from "vitest";

// The container healthcheck (Dockerfile) and Coolify's rollout both ask this
// URL, so it must answer without a session and without touching the database.
// A database import that throws at load would fail this file the same way it
// would fail the check, which is the point of importing the handler cold.
vi.mock("@/server/db/client", () => {
  throw new Error("the health route must not load the database");
});

import { GET, dynamic } from "./route";

describe("GET /api/health", () => {
  it("answers 200 {ok:true} without a session and without the database", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("is never prerendered, or `next build` would freeze the answer", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
