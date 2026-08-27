import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { tripInvites, tripMemberships } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { acceptInvite, createInvite } from "@/server/access/invites";

const OWNER = "access-owner";
const GUEST = "access-guest";
const STRANGER = "access-stranger";

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the routes pick up the mocked `auth`.
const { GET } = await import("./route");
const { POST: CREATE_INVITE } = await import("../invites/route");
const { DELETE: REVOKE_INVITE } = await import("../invites/[inviteId]/route");
const { GET: GET_PAGES, POST: CREATE_PAGE } = await import("../pages/route");

// No DB truncation: every test seeds its own randomUUID() trip and reads back
// through it — same convention as the sibling route int tests.
async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Access" }, OWNER);
  if (!result.ok) throw new Error("failed to seed trip");
  return tripId;
}

async function join(tripId: string, role: "viewer" | "editor", userId = GUEST): Promise<void> {
  const invite = await createInvite(tripId, OWNER, { email: null, role });
  const accepted = await acceptInvite(invite.token, userId);
  if (!accepted.ok) throw new Error(`failed to accept: ${accepted.error.message}`);
}

const params = (tripId: string) => ({ params: Promise.resolve({ tripId }) });

beforeEach(() => {
  currentUserId = OWNER;
});

describe("GET /api/trips/:id/access", () => {
  it("401s when unauthenticated", async () => {
    const tripId = await seedTrip();
    currentUserId = "";
    expect((await GET(new Request("http://test/x"), params(tripId))).status).toBe(401);
  });

  it("403s for a stranger", async () => {
    const tripId = await seedTrip();
    currentUserId = STRANGER;
    expect((await GET(new Request("http://test/x"), params(tripId))).status).toBe(403);
  });

  it("gives the owner their role, the members, and the outstanding invites", async () => {
    const tripId = await seedTrip();
    await createInvite(tripId, OWNER, { email: "someone@example.com", role: "viewer" });
    const body = (await (await GET(new Request("http://test/x"), params(tripId))).json()) as {
      access: { myRole: string; members: { userId: string }[]; invites: { email: string | null }[] };
    };
    expect(body.access.myRole).toBe("owner");
    expect(body.access.members.map((m) => m.userId)).toEqual([OWNER]);
    expect(body.access.invites.map((i) => i.email)).toEqual(["someone@example.com"]);
  });

  // A TripInvite carries its token, so listing invites IS handing out access.
  it("shows a non-owner member the travellers but never the invite tokens", async () => {
    const tripId = await seedTrip();
    await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    await join(tripId, "editor");
    currentUserId = GUEST;

    const body = (await (await GET(new Request("http://test/x"), params(tripId))).json()) as {
      access: { myRole: string; members: { userId: string }[]; invites: unknown[] };
    };
    expect(body.access.myRole).toBe("editor");
    expect(body.access.members.map((m) => m.userId)).toEqual([OWNER, GUEST]);
    expect(body.access.invites).toEqual([]);
  });
});

describe("POST /api/trips/:id/invites", () => {
  const post = (tripId: string, body: unknown) =>
    CREATE_INVITE(
      new Request("http://test/x", { method: "POST", body: JSON.stringify(body) }),
      params(tripId),
    );

  it("mints an invite for the owner", async () => {
    const tripId = await seedTrip();
    const res = await post(tripId, { email: null, role: "editor" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invite: { token: string; status: string } };
    expect(body.invite.status).toBe("pending");
    expect(body.invite.token.length).toBeGreaterThan(20);
  });

  it("403s an editor — an editor plans the trip, an owner decides who is on it", async () => {
    const tripId = await seedTrip();
    await join(tripId, "editor");
    currentUserId = GUEST;
    expect((await post(tripId, { email: null, role: "viewer" })).status).toBe(403);
  });

  it("400s a role that is not on offer (owner is never invited)", async () => {
    const tripId = await seedTrip();
    expect((await post(tripId, { email: null, role: "owner" })).status).toBe(400);
  });

  it("400s a malformed email rather than storing a blank label", async () => {
    const tripId = await seedTrip();
    expect((await post(tripId, { email: "", role: "viewer" })).status).toBe(400);
  });
});

describe("DELETE /api/trips/:id/invites/:inviteId", () => {
  it("403s a non-owner", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    await join(tripId, "editor");
    currentUserId = GUEST;
    const res = await REVOKE_INVITE(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ tripId, inviteId: invite.inviteId }),
    });
    expect(res.status).toBe(403);
  });

  it("revokes for the owner", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "viewer" });
    const res = await REVOKE_INVITE(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ tripId, inviteId: invite.inviteId }),
    });
    expect(res.status).toBe(200);
    const rows = await db.select().from(tripInvites);
    expect(rows.find((r) => r.id === invite.inviteId)?.status).toBe("revoked");
  });
});

// The hole M11 link 3 was told to close before issuing any viewer invite:
// `guard()` used to check membership with NO role, and it fronts both the
// Notebook page writes and the AI handler.
describe("a viewer is read-only everywhere", () => {
  it("may read the Notebook but not write to it", async () => {
    const tripId = await seedTrip();
    await join(tripId, "viewer");
    currentUserId = GUEST;

    expect((await GET_PAGES(new Request("http://test/x"), params(tripId))).status).toBe(200);

    const create = await CREATE_PAGE(
      new Request("http://test/x", {
        method: "POST",
        body: JSON.stringify({
          title: "Sneaky",
          context: { tripId, scope: "trip" },
          content: { type: "doc", content: [] },
        }),
      }),
      params(tripId),
    );
    expect(create.status).toBe(403);
  });

  it("an editor may write to the Notebook", async () => {
    const tripId = await seedTrip();
    await join(tripId, "editor");
    currentUserId = GUEST;
    const create = await CREATE_PAGE(
      new Request("http://test/x", {
        method: "POST",
        body: JSON.stringify({
          title: "Notes",
          context: { tripId, scope: "trip" },
          content: { type: "doc", content: [] },
        }),
      }),
      params(tripId),
    );
    expect(create.status).toBe(201);
  });
});

describe("membership rows", () => {
  it("records who invited a member, for the audit trail CRUD modules keep", async () => {
    const tripId = await seedTrip();
    await join(tripId, "viewer");
    const rows = await db.select().from(tripMemberships);
    const row = rows.find((r) => r.tripId === tripId);
    expect(row?.invitedBy).toBe(OWNER);
    expect(row?.role).toBe("viewer");
  });
});
