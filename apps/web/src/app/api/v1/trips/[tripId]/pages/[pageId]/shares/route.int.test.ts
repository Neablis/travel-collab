// The v1 page-share routes as real HTTP: the scope split (trips:read lists,
// sharing:write changes), the editor gate, the 422, and the cursor.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { newPageDoc } from "@tc/contracts";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { mintToken } from "@/server/api-tokens";
import { acceptInvite, createInvite } from "@/server/access/invites";
import { createPageShare, revokePageShare } from "@/server/access/pageShares";
import { executeTripCommand } from "@/server/commands";
import { executePageCommand } from "@/server/pageCommands";
import { listPages } from "@/server/pages";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const { GET, POST } = await import("./route");
const { DELETE } = await import("./[shareId]/route");

const RUN = randomUUID().slice(0, 8);
const P = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

async function user(entitle: boolean): Promise<string> {
  const id = `v1ps-${RUN}-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  if (entitle) {
    const premium = livePlanVersion("premium");
    await issueGrant({
      userId: id,
      planId: premium.planId,
      planVersion: premium.version,
      source: "admin",
      grantedBy: "dev-operator",
      reason: "M58 fixture.",
      expiresAt: null,
    });
  }
  return id;
}

async function tokenFor(userId: string, scopes: string[]): Promise<string> {
  const minted = await mintToken(userId, {
    name: "page-shares",
    scopes: scopes as Parameters<typeof mintToken>[1]["scopes"],
    tripIds: null,
    expiresInDays: 30,
  });
  if (!minted.ok) throw new Error("mint failed");
  return minted.created.secret;
}

const req = (secret: string, method = "GET", url = "http://localhost/x") =>
  new Request(url, { method, headers: { authorization: `Bearer ${secret}` } });

async function seed(owner: string): Promise<{ tripId: string; pageId: string }> {
  const tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Public" }, owner)).ok).toBe(true);
  const pageId = randomUUID();
  const page = await executePageCommand(
    { type: "CreatePage", tripId, pageId, title: "Notes", context: { tripId }, content: newPageDoc() },
    owner,
  );
  expect(page.ok).toBe(true);
  return { tripId, pageId };
}

describe("v1 page shares", () => {
  it("splits scopes: sharing:write publishes and revokes, trips:read only lists", async () => {
    const owner = await user(true);
    const { tripId, pageId } = await seed(owner);
    const write = await tokenFor(owner, ["sharing:write"]);
    const read = await tokenFor(owner, ["trips:read"]);

    expect((await POST(req(read, "POST"), P({ tripId, pageId }))).status).toBe(403);
    const made = await POST(req(write, "POST"), P({ tripId, pageId }));
    expect(made.status).toBe(201);
    const share = await made.json();

    expect((await GET(req(write), P({ tripId, pageId }))).status).toBe(403);
    const listed = await GET(req(read), P({ tripId, pageId }));
    expect(listed.status).toBe(200);
    expect((await listed.json()).items).toHaveLength(1);

    const ids = P({ tripId, pageId, shareId: share.shareId });
    expect((await DELETE(req(read, "DELETE"), ids)).status).toBe(403);
    const revoked = await DELETE(req(write, "DELETE"), ids);
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).revokedAt).not.toBeNull();
  });

  it("holds the editor gate: a viewer's token with every scope is refused", async () => {
    const owner = await user(true);
    const viewer = await user(true);
    const { tripId, pageId } = await seed(owner);
    const invite = await createInvite(tripId, owner, { email: null, role: "viewer" });
    expect((await acceptInvite(invite.token, viewer)).ok).toBe(true);
    const viewerToken = await tokenFor(viewer, ["sharing:write", "trips:read"]);

    expect((await POST(req(viewerToken, "POST"), P({ tripId, pageId }))).status).toBe(403);
    expect((await GET(req(viewerToken), P({ tripId, pageId }))).status).toBe(403);
  });

  it("answers 422 for a seeded notebook that can't be public", async () => {
    const owner = await user(true);
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Seeds" }, owner);
    const money = (await listPages(tripId)).find((p) => p.seedKey === "money");
    expect(money).toBeDefined();
    const write = await tokenFor(owner, ["sharing:write"]);
    const refused = await POST(req(write, "POST"), P({ tripId, pageId: money!.id }));
    expect(refused.status).toBe(422);
    expect((await refused.json()).error.message).toBe("This notebook can't be made public.");
  });

  it("pages through links that share a millisecond without skipping or repeating one", async () => {
    const owner = await user(true);
    const { tripId, pageId } = await seed(owner);
    const same = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      const link = await createPageShare(tripId, pageId, owner, same);
      if (!link.ok) throw new Error(link.error.message);
      await revokePageShare(tripId, pageId, link.value.shareId, same);
    }
    const read = await tokenFor(owner, ["trips:read"]);
    const seen: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 5; guard++) {
      const url: string = `http://localhost/x?limit=1${after === null ? "" : `&cursor=${encodeURIComponent(after)}`}`;
      const body = await (await GET(req(read, "GET", url), P({ tripId, pageId }))).json();
      seen.push(...body.items.map((s: { shareId: string }) => s.shareId));
      after = body.nextCursor;
      if (after === null) break;
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });
});
