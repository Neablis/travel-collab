// **The token-management routes** (M22 Phase 3), against a real database.
//
// These live under `/api/*` and NOT under `v1/`, which is the security decision
// this file exists to pin: a token that could mint or revoke tokens could grant
// itself scopes its owner never approved and outlive its own revocation. The
// last test asserts the separation directly.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant, allGrantsFor, revokeGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";

let currentUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId === null ? null : { user: { id: currentUserId } })),
}));

const { GET: LIST, POST: CREATE } = await import("./route");
const { DELETE: REVOKE } = await import("./[tokenId]/route");

const RUN = randomUUID().slice(0, 8);

async function account(): Promise<string> {
  const id = `tok-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  return id;
}

/** Entitled by GRANT — no Stripe anywhere in this file. */
async function entitled(): Promise<string> {
  const id = await account();
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M22 Phase 3 fixture.",
    expiresAt: null,
  });
  return id;
}

const post = (body: unknown) =>
  new Request("http://localhost/api/account/tokens", {
    method: "POST",
    body: JSON.stringify(body),
  });

const valid = { name: "Calendar sync", scopes: ["trips:read"], tripIds: null, expiresInDays: 90 };

describe("creating a token", () => {
  it("returns the secret exactly once, with the token beside it", async () => {
    currentUserId = await entitled();
    const res = await CREATE(post(valid));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret.startsWith("tc_")).toBe(true);
    expect(body.token.name).toBe("Calendar sync");

    // And the list never carries it again, because nothing stored it.
    const listed = await (await LIST()).json();
    expect(JSON.stringify(listed)).not.toContain(body.secret);
    expect(listed.tokens).toHaveLength(1);
  });

  // 402, matching the existing `AI_NOT_ENTITLED_STATUS` rather than inventing a
  // second shape for the same idea.
  it("refuses a free account with 402", async () => {
    currentUserId = await account();
    const res = await CREATE(post(valid));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("api-not-entitled");
  });

  it("refuses a lifetime past the ceiling rather than clamping it", async () => {
    currentUserId = await entitled();
    const res = await CREATE(post({ ...valid, expiresInDays: 366 }));
    expect(res.status).toBe(400);
    // Nothing was created — a refusal is not a silently shortened token.
    expect((await (await LIST()).json()).tokens).toHaveLength(0);
  });

  it("refuses a nameless or scopeless token", async () => {
    currentUserId = await entitled();
    expect((await CREATE(post({ ...valid, name: "   " }))).status).toBe(400);
    expect((await CREATE(post({ ...valid, scopes: [] }))).status).toBe(400);
    expect((await CREATE(post({ ...valid, expiresInDays: undefined }))).status).toBe(400);
  });

  it("refuses an anonymous caller", async () => {
    currentUserId = null;
    expect((await CREATE(post(valid))).status).toBe(401);
    expect((await LIST()).status).toBe(401);
  });
});

describe("a lapsed account keeps control of what it already holds", () => {
  // **Listing and revoking are deliberately NOT gated on the entitlement.**
  // Refusing would leave live credentials the owner can no longer reach, which
  // is the opposite of what a lapse should do — and taking away someone's
  // ability to switch off a credential because they stopped paying is
  // indefensible.
  it("can still list and revoke after losing the entitlement", async () => {
    currentUserId = await entitled();
    const created = await (await CREATE(post(valid))).json();

    const [grant] = await allGrantsFor(currentUserId);
    expect(await revokeGrant(grant!.id, "dev-operator")).toBe(true);

    // Minting is refused…
    expect((await CREATE(post(valid))).status).toBe(402);
    // …but the list still answers, and the revoke still works.
    const listed = await (await LIST()).json();
    expect(listed.tokens).toHaveLength(1);

    const revoked = await REVOKE(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ tokenId: created.token.tokenId }),
    });
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).token.revokedAt).not.toBeNull();
  });
});

describe("revoking", () => {
  it("is idempotent and scoped to the owner", async () => {
    const owner = await entitled();
    const stranger = await entitled();
    currentUserId = owner;
    const created = await (await CREATE(post(valid))).json();
    const tokenId = created.token.tokenId;
    const del = (id: string) =>
      REVOKE(new Request("http://localhost/x", { method: "DELETE" }), {
        params: Promise.resolve({ tokenId: id }),
      });

    expect((await del(tokenId)).status).toBe(200);
    // Already-revoked is ok, not 404 — a double-click must not produce a scary
    // error (`revokeShare`'s rule).
    expect((await del(tokenId)).status).toBe(200);

    // A stranger gets "no such token", and a non-uuid gets 404 rather than a
    // Postgres `22P02` 500 (KI-2026-09-05-x).
    currentUserId = stranger;
    expect((await del(tokenId)).status).toBe(404);
    expect((await del("not-a-uuid")).status).toBe(404);

    currentUserId = null;
    expect((await del(tokenId)).status).toBe(401);
  });
});

describe("managing tokens is session-only, and that is the point", () => {
  // **A token may not manage tokens.** This surface is not under `v1/`, so the
  // wrapper never sees it and no scope names it — a bearer credential reaching
  // it would be the classic privilege escalation: mint yourself wider scopes,
  // or outlive your own revocation.
  it("is not reachable with a bearer token, however wide its scopes", async () => {
    const owner = await entitled();
    const minted = await mintToken(owner, {
      name: "Everything",
      // Every scope there is. None of them is this route's.
      scopes: ["trips:read", "trips:write", "notebook:read", "notebook:write", "library:read", "library:write", "sharing:write", "account:read"],
      tripIds: null,
      expiresInDays: 30,
    });
    expect(minted.ok).toBe(true);

    currentUserId = null;
    const withBearer = new Request("http://localhost/api/account/tokens", {
      method: "POST",
      headers: { authorization: `Bearer ${minted.ok ? minted.created.secret : ""}` },
      body: JSON.stringify(valid),
    });
    // 401: the route reads the session and nothing else. The header is not
    // consulted, not rejected — it simply has no meaning here.
    expect((await CREATE(withBearer)).status).toBe(401);
  });

  it("lives outside the public API directory, where the wrapper cannot reach it", async () => {
    const { existsSync } = await import("node:fs");
    // If this ever moves under `v1/`, the conformance test would demand a scope
    // for it — and there must never be one.
    expect(existsSync(`${process.cwd()}/src/app/api/v1/account/tokens`)).toBe(false);
    expect(existsSync(`${process.cwd()}/src/app/api/account/tokens/route.ts`)).toBe(true);
  });
});
