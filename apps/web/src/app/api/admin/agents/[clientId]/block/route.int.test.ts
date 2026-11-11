// **The kill switch's only door** (ADR-089 decision 3), against a real database:
// an operator blocks and unblocks by `client_id`, anyone else finds no route,
// and the block is what the token endpoint reads.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { oauthClientBlocks, users } from "@/server/db/schema";
import { clientIsBlocked } from "@/server/oauth/clients";
import { upsertUser } from "@/server/users";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { PUT, DELETE } = await import("./route");

async function account(admin: boolean): Promise<string> {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  await db.update(users).set({ isAdmin: admin }).where(eq(users.id, id));
  return id;
}

const clientIdOf = () => `https://${randomUUID()}.agent.test/poppy-client.json`;
// As Next hands the segment: the URL, percent-encoded or not.
const params = (clientId: string, encoded = true) => ({ params: Promise.resolve({ clientId: encoded ? encodeURIComponent(clientId) : clientId }) });
const request = (method: string) => new Request("http://localhost/x", { method });

afterEach(() => {
  currentUserId = "";
});

describe("PUT and DELETE /api/admin/agents/[clientId]/block", () => {
  it("404s a non-operator on both, and nothing is written", async () => {
    const clientId = clientIdOf();
    currentUserId = await account(false);
    expect((await PUT(request("PUT"), params(clientId))).status).toBe(404);
    expect(await clientIsBlocked(clientId)).toBe(false);
    currentUserId = "";
    expect((await DELETE(request("DELETE"), params(clientId))).status).toBe(404);
  });

  it("blocks by client_id, records who did, is idempotent, and unblocks", async () => {
    const clientId = clientIdOf();
    const operator = await account(true);
    currentUserId = operator;

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await PUT(request("PUT"), params(clientId));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ clientId, blocked: true });
    }
    expect(await clientIsBlocked(clientId)).toBe(true);
    const [row] = await db.select().from(oauthClientBlocks).where(eq(oauthClientBlocks.clientId, clientId));
    expect(row?.blockedBy).toBe(operator);

    const lifted = await DELETE(request("DELETE"), params(clientId, false));
    expect(await lifted.json()).toEqual({ clientId, blocked: false });
    expect(await clientIsBlocked(clientId)).toBe(false);
    expect((await DELETE(request("DELETE"), params(clientId))).status).toBe(200);
  });

  it("refuses a client_id that is not an https URL", async () => {
    currentUserId = await account(true);
    for (const bad of ["not-a-url", "http://agent.test/x", "%E0%A4%A"]) {
      const res = await PUT(request("PUT"), { params: Promise.resolve({ clientId: bad }) });
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid-client-id" });
    }
  });
});
