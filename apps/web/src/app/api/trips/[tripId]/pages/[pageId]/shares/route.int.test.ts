import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newPageDoc } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { executePageCommand } from "@/server/pageCommands";
import { listPages } from "@/server/pages";
import { db } from "@/server/db/client";
import { pages } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { acceptInvite, createInvite } from "@/server/access/invites";
import { grantMembership } from "@/server/access/members";
import { readPageShare } from "@/server/access/pageShares";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

const OWNER = "pshares-route-owner";
const EDITOR = "pshares-route-editor";
const VIEWER = "pshares-route-viewer";
const SUGGESTER = "pshares-route-suggester";
const STRANGER = "pshares-route-stranger";

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET, POST } = await import("./route");
const { DELETE } = await import("./[shareId]/route");

// Every test seeds its own trip (the sibling suites' convention): no truncation.
async function seed(): Promise<{ tripId: string; pageId: string }> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Public" }, OWNER);
  if (!created.ok) throw new Error("failed to seed trip");
  const pageId = randomUUID();
  const page = await executePageCommand(
    { type: "CreatePage", tripId, pageId, title: "Notes", context: { tripId }, content: newPageDoc() },
    OWNER,
  );
  if (!page.ok) throw new Error("failed to seed page");
  return { tripId, pageId };
}

async function join(tripId: string, role: "viewer" | "editor", userId: string): Promise<void> {
  const invite = await createInvite(tripId, OWNER, { email: null, role });
  const accepted = await acceptInvite(invite.token, userId);
  if (!accepted.ok) throw new Error(accepted.error.message);
}

const params = (tripId: string, pageId: string) => ({ params: Promise.resolve({ tripId, pageId }) });
const req = (method = "GET") => new Request("http://test/x", { method });

// The owner must be able to collaborate for invites to grant above viewer.
beforeAll(async () => {
  await entitleAccounts([OWNER]);
});

beforeEach(() => {
  currentUserId = OWNER;
});

describe("POST /api/trips/:id/pages/:pageId/shares", () => {
  it("201s an editor with a token, and the token reads the page", async () => {
    const { tripId, pageId } = await seed();
    await join(tripId, "editor", EDITOR);
    currentUserId = EDITOR;
    const res = await POST(req("POST"), params(tripId, pageId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { share: { token: string } };
    expect((await readPageShare(body.share.token)).ok).toBe(true);
  });

  it("403s a viewer and a suggester, and creates nothing", async () => {
    const { tripId, pageId } = await seed();
    await join(tripId, "viewer", VIEWER);
    await grantMembership(db, { tripId, userId: SUGGESTER, role: "suggester", invitedBy: OWNER, now: new Date().toISOString() });
    for (const who of [VIEWER, SUGGESTER]) {
      currentUserId = who;
      expect((await POST(req("POST"), params(tripId, pageId))).status, who).toBe(403);
    }
    currentUserId = OWNER;
    const listed = (await (await GET(req(), params(tripId, pageId))).json()) as { shares: unknown[] };
    expect(listed.shares).toEqual([]);
  });

  it("401s without a session and 403s a stranger", async () => {
    const { tripId, pageId } = await seed();
    currentUserId = "";
    expect((await POST(req("POST"), params(tripId, pageId))).status).toBe(401);
    currentUserId = STRANGER;
    expect((await POST(req("POST"), params(tripId, pageId))).status).toBe(403);
  });

  it("422s the seeded Bookings, Money and During-the-trip pages", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Seeds" }, OWNER);
    await listPages(tripId); // seeds the defaults
    const rows = await db.select().from(pages).where(eq(pages.tripId, tripId));
    for (const key of ["bookings-and-confirmations", "money", "today"]) {
      const seeded = rows.find((r) => r.seedKey === key);
      expect(seeded, key).toBeDefined();
      expect((await POST(req("POST"), params(tripId, seeded!.id))).status, key).toBe(422);
    }
  });

  it("404s a page that is not this trip's, and 422s a deleted trip", async () => {
    const a = await seed();
    const b = await seed();
    expect((await POST(req("POST"), params(b.tripId, a.pageId))).status).toBe(404);
    await executeTripCommand({ type: "DeleteTrip", tripId: a.tripId }, OWNER);
    expect((await POST(req("POST"), params(a.tripId, a.pageId))).status).toBe(422);
  });
});

describe("DELETE /api/trips/:id/pages/:pageId/shares/:shareId", () => {
  it("lets an editor revoke, idempotently, and 403s a viewer", async () => {
    const { tripId, pageId } = await seed();
    await join(tripId, "viewer", VIEWER);
    const made = (await (await POST(req("POST"), params(tripId, pageId))).json()) as { share: { shareId: string; token: string } };
    const target = (who: string) => {
      currentUserId = who;
      return DELETE(req("DELETE"), { params: Promise.resolve({ tripId, pageId, shareId: made.share.shareId }) });
    };
    expect((await target(VIEWER)).status).toBe(403);
    expect((await readPageShare(made.share.token)).ok).toBe(true);

    expect((await target(OWNER)).status).toBe(200);
    expect((await target(OWNER)).status).toBe(200);
    expect((await readPageShare(made.share.token)).ok).toBe(false);
  });

  it("404s a share id that is not a uuid", async () => {
    const { tripId, pageId } = await seed();
    const res = await DELETE(req("DELETE"), { params: Promise.resolve({ tripId, pageId, shareId: "nope" }) });
    expect(res.status).toBe(404);
  });
});
