// **Account → Security → Connected apps, Disconnect** (M55 D10), against a real database:
// the owner's revoke cuts off the grant's refresh and access tokens on their
// next use, says yes again on a second click, and knows no other owner's grant.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/users";
import { grantOf } from "@/server/oauth/grants";
import { refresh } from "@/server/oauth/tokens";
import { verifyAccessToken } from "@/server/oauth/verifyAccess";
import { connectForTest } from "@/server/test-support/oauthConnection";

let currentUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId === null ? null : { user: { id: currentUserId } })),
}));

const { DELETE: DISCONNECT } = await import("./route");

const RUN = randomUUID().slice(0, 8);

async function account(): Promise<string> {
  const id = `apps-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  return id;
}

const disconnect = (grantId: string, headers: HeadersInit = {}) =>
  DISCONNECT(new Request("http://localhost/x", { method: "DELETE", headers }), {
    params: Promise.resolve({ grantId }),
  });

describe("disconnecting an app", () => {
  it("revokes the grant as the owner, and its tokens stop on their next use", async () => {
    const owner = await account();
    const connected = await connectForTest(owner);
    currentUserId = owner;

    expect((await disconnect(connected.grant.id)).status).toBe(204);
    expect(await grantOf(connected.grant.id)).toMatchObject({ revokedReason: "owner" });

    const verified = await verifyAccessToken(connected.access);
    expect(verified.ok ? "accepted" : verified.refusal.reason).toBe("revoked");
    const refreshed = await refresh({ refreshToken: connected.refresh, clientId: connected.clientId });
    expect(refreshed.ok ? "refreshed" : refreshed.error).toBe("invalid_grant");
  });

  // A double-click must not produce a scary error (`revokeShare`'s rule).
  it("is idempotent", async () => {
    const owner = await account();
    const { grant } = await connectForTest(owner);
    currentUserId = owner;
    expect((await disconnect(grant.id)).status).toBe(204);
    expect((await disconnect(grant.id)).status).toBe(204);
  });

  // "No such app" for a stranger, never a revoke of somebody else's grant; and
  // a non-uuid is a 404 rather than a Postgres `22P02` 500 (KI-2026-09-05-x).
  it("answers 404 for another owner's grant, and leaves it live", async () => {
    const owner = await account();
    const { grant } = await connectForTest(owner);
    currentUserId = await account();
    expect((await disconnect(grant.id)).status).toBe(404);
    expect((await grantOf(grant.id))?.revokedAt).toBeNull();
    expect((await disconnect("not-a-uuid")).status).toBe(404);
  });

  // The grant's own access token is refused here: an app may not disconnect
  // itself or anything else, because this route reads the session alone.
  it("refuses an anonymous caller, bearer or not", async () => {
    const owner = await account();
    const { grant, access } = await connectForTest(owner);
    currentUserId = null;
    expect((await disconnect(grant.id)).status).toBe(401);
    expect((await disconnect(grant.id, { authorization: `Bearer ${access}` })).status).toBe(401);
    expect((await grantOf(grant.id))?.revokedAt).toBeNull();
  });
});
