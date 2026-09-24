// **`Idempotency-Key` in the wrapper, against a real database** (ADR-051).
//
// Driven through an endpoint declared here rather than a real one, because the
// cases worth attacking are the wrapper's — a handler that fails, a handler
// still running when the retry arrives — and a real endpoint cannot be made to
// do either on demand. The real endpoint's replay is in `playbooks.int.test.ts`.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { db } from "@/server/db/client";
import { apiIdempotencyKeys } from "@/server/db/schema";
import { IDEMPOTENCY_LEASE_MS, requestHash } from "./idempotency";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const { route } = await import("./route");

const RUN = randomUUID().slice(0, 8);
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };

async function tokenForNewUser(): Promise<{ userId: string; secret: string }> {
  const userId = `v1i-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id: userId, email: `${userId}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "ADR-051 idempotency fixture.",
    expiresAt: null,
  });
  const minted = await mintToken(userId, {
    name: "idempotency",
    scopes: ["library:write"],
    tripIds: null,
    expiresInDays: 30,
  });
  if (!minted.ok) throw new Error("mint failed");
  return { userId, secret: minted.created.secret };
}

/** An endpoint whose handler does whatever the test says next, and counts its runs. */
function counted() {
  let runs = 0;
  let next: () => Promise<unknown> = async () => ({ n: runs });
  const { POST } = route({
    POST: {
      summary: "test endpoint",
      scope: "library:write",
      body: z.object({ value: z.string() }),
      response: z.object({ n: z.number() }),
      idempotent: true,
      handle: async () => {
        runs += 1;
        return next();
      },
    },
  });
  return {
    POST,
    get runs() {
      return runs;
    },
    then(handler: () => Promise<unknown>) {
      next = handler;
    },
  };
}

const post = (secret: string, key: string | null, value = "a") =>
  new Request(`http://localhost/api/v1/test-${RUN}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      ...(key === null ? {} : { "Idempotency-Key": key }),
    },
    body: JSON.stringify({ value }),
  });

describe("Idempotency-Key in route()", () => {
  it("does not keep a 5xx: the key is released and the retry runs", async () => {
    const { userId, secret } = await tokenForNewUser();
    const endpoint = counted();
    const key = randomUUID();

    endpoint.then(async () => {
      throw new Error("the handler broke");
    });
    const failed = await endpoint.POST(post(secret, key), NO_PARAMS);
    expect(failed.status).toBe(500);
    const rows = await db
      .select()
      .from(apiIdempotencyKeys)
      .where(and(eq(apiIdempotencyKeys.userId, userId), eq(apiIdempotencyKeys.key, key)));
    expect(rows).toEqual([]);

    endpoint.then(async () => ({ n: endpoint.runs }));
    const retried = await endpoint.POST(post(secret, key), NO_PARAMS);
    expect(retried.status).toBe(201);
    expect(retried.headers.get("Idempotent-Replayed")).toBeNull();
    expect(endpoint.runs).toBe(2);

    // Now kept: the third is a replay, and the handler does not run.
    const replayed = await endpoint.POST(post(secret, key), NO_PARAMS);
    expect(replayed.status).toBe(201);
    expect(replayed.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await replayed.json()).toEqual({ n: 2 });
    expect(endpoint.runs).toBe(2);
  });

  it("answers 409 to the same key while the first request is still running, and runs once", async () => {
    const { secret } = await tokenForNewUser();
    const endpoint = counted();
    const key = randomUUID();

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const running = new Promise<void>((resolve) => (entered = resolve));
    // Only the first run is held, so a second run — the defect — answers
    // rather than hanging the test.
    endpoint.then(async () => {
      if (endpoint.runs === 1) {
        entered();
        await held;
      }
      return { n: endpoint.runs };
    });

    const first = endpoint.POST(post(secret, key), NO_PARAMS);
    await running;
    const second = await endpoint.POST(post(secret, key), NO_PARAMS);
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("conflict");

    release();
    expect((await first).status).toBe(201);
    expect(endpoint.runs).toBe(1);
  });

  it("keeps a 500 that came after the handler finished — a payload failing its own schema — and runs once", async () => {
    const { secret } = await tokenForNewUser();
    const endpoint = counted();
    const key = randomUUID();
    // The handler's writes would have committed by now; only the answer is bad.
    endpoint.then(async () => ({ n: "not a number" }));

    const first = await endpoint.POST(post(secret, key), NO_PARAMS);
    expect(first.status).toBe(500);
    const again = await endpoint.POST(post(secret, key), NO_PARAMS);
    expect(again.status).toBe(500);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect(endpoint.runs).toBe(1);
  });

  it("takes over a reservation abandoned past its lease, and runs", async () => {
    const { userId, secret } = await tokenForNewUser();
    const endpoint = counted();
    const key = randomUUID();
    // What a process that died mid-handler leaves: the same request, reserved,
    // never completed, older than the lease — but well inside the 24 hours.
    await db.insert(apiIdempotencyKeys).values({
      userId,
      key,
      method: "POST",
      path: `/api/v1/test-${RUN}`,
      requestHash: requestHash({ value: "a" }),
      createdAt: new Date(Date.now() - IDEMPOTENCY_LEASE_MS - 60_000),
    });

    const res = await endpoint.POST(post(secret, key), NO_PARAMS);
    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotent-Replayed")).toBeNull();
    expect(endpoint.runs).toBe(1);
  });

  it("keeps a 4xx the handler answered, and replays it", async () => {
    const { PublicApiError } = await import("./commands");
    const { secret } = await tokenForNewUser();
    const endpoint = counted();
    const key = randomUUID();
    endpoint.then(async () => {
      throw new PublicApiError(404, "No such thing.");
    });

    expect((await endpoint.POST(post(secret, key), NO_PARAMS)).status).toBe(404);
    const again = await endpoint.POST(post(secret, key), NO_PARAMS);
    expect(again.status).toBe(404);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect((await again.json()).error.message).toBe("No such thing.");
    expect(endpoint.runs).toBe(1);
  });

  it("runs every request that sends no key, and refuses a key over 255 characters before running", async () => {
    const { secret } = await tokenForNewUser();
    const endpoint = counted();
    await endpoint.POST(post(secret, null), NO_PARAMS);
    await endpoint.POST(post(secret, null), NO_PARAMS);
    expect(endpoint.runs).toBe(2);

    const long = await endpoint.POST(post(secret, "k".repeat(256)), NO_PARAMS);
    expect(long.status).toBe(400);
    expect(endpoint.runs).toBe(2);
  });
});
