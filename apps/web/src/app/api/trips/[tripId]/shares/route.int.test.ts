import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { acceptInvite, createInvite } from "@/server/access/invites";
import { createShare } from "@/server/access/shares";

const OWNER = "shares-route-owner";
const EDITOR = "shares-route-editor";
const VIEWER = "shares-route-viewer";
const STRANGER = "shares-route-stranger";

let currentUserId = OWNER;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET, POST } = await import("./route");
const { DELETE } = await import("./[shareId]/route");
const { GET: PUBLIC_GET } = await import("../../../shares/[token]/route");

// No DB truncation: every test seeds its own randomUUID() trip and reads back
// through it — the convention the sibling route int tests use.
async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Shares" }, OWNER);
  if (!result.ok) throw new Error("failed to seed trip");
  return tripId;
}

async function join(tripId: string, role: "viewer" | "editor", userId: string): Promise<void> {
  const invite = await createInvite(tripId, OWNER, { email: null, role });
  const accepted = await acceptInvite(invite.token, userId);
  if (!accepted.ok) throw new Error(accepted.error.message);
}

const params = (tripId: string) => ({ params: Promise.resolve({ tripId }) });
const req = (method = "GET") => new Request("http://test/x", { method });

beforeEach(() => {
  currentUserId = OWNER;
});

describe("POST /api/trips/:id/shares", () => {
  it("401s when unauthenticated", async () => {
    const tripId = await seedTrip();
    currentUserId = "";
    expect((await POST(req("POST"), params(tripId))).status).toBe(401);
  });

  it("403s a stranger", async () => {
    const tripId = await seedTrip();
    currentUserId = STRANGER;
    expect((await POST(req("POST"), params(tripId))).status).toBe(403);
  });

  it("mints a link pinned to the trip's current history point", async () => {
    const tripId = await seedTrip();
    await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, OWNER);
    const res = await POST(req("POST"), params(tripId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { share: { seq: number; token: string } };
    expect(body.share.seq).toBe(2);
    expect(body.share.token.length).toBeGreaterThan(20);
  });

  // Deliberately a different line from invites, which are owner-only: a share
  // grants a read of one frozen point, which is within what a planning
  // participant already does (ADR-027).
  it("lets an editor share", async () => {
    const tripId = await seedTrip();
    await join(tripId, "editor", EDITOR);
    currentUserId = EDITOR;
    expect((await POST(req("POST"), params(tripId))).status).toBe(201);
  });

  // A viewer handing out access they were themselves given is the one case
  // this line has to exclude.
  it("403s a viewer", async () => {
    const tripId = await seedTrip();
    await join(tripId, "viewer", VIEWER);
    currentUserId = VIEWER;
    expect((await POST(req("POST"), params(tripId))).status).toBe(403);
  });

  it("400s on a deleted trip", async () => {
    const tripId = await seedTrip();
    await executeTripCommand({ type: "DeleteTrip", tripId }, OWNER);
    expect((await POST(req("POST"), params(tripId))).status).toBe(400);
  });
});

describe("GET / DELETE /api/trips/:id/shares", () => {
  it("lists the trip's links for a participant and 403s a viewer", async () => {
    const tripId = await seedTrip();
    await createShare(tripId, OWNER);
    expect((await GET(req(), params(tripId))).status).toBe(200);

    await join(tripId, "viewer", VIEWER);
    currentUserId = VIEWER;
    expect((await GET(req(), params(tripId))).status).toBe(403);
  });

  it("turns a link off", async () => {
    const tripId = await seedTrip();
    const share = await createShare(tripId, OWNER);
    if (!share.ok) throw new Error("failed to share");
    const res = await DELETE(req("DELETE"), {
      params: Promise.resolve({ tripId, shareId: share.value.shareId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { share: { revokedAt: string | null } };
    expect(body.share.revokedAt).not.toBeNull();
  });
});

// The one endpoint in this app a stranger may call. That it works with NO
// session is the feature, not an oversight.
describe("GET /api/shares/:token — public", () => {
  it("serves the trip to a caller with no session at all", async () => {
    const tripId = await seedTrip();
    const share = await createShare(tripId, OWNER);
    if (!share.ok) throw new Error("failed to share");

    currentUserId = "";
    const res = await PUBLIC_GET(req(), { params: Promise.resolve({ token: share.value.token }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trip: { name: string; travellerCount: number } };
    expect(body.trip.name).toBe("Shares");
    expect(body.trip.travellerCount).toBe(1);
  });

  it("404s an unknown token and 410s a revoked one", async () => {
    const tripId = await seedTrip();
    const share = await createShare(tripId, OWNER);
    if (!share.ok) throw new Error("failed to share");
    currentUserId = "";

    expect(
      (await PUBLIC_GET(req(), { params: Promise.resolve({ token: "nope" }) })).status,
    ).toBe(404);

    currentUserId = OWNER;
    await DELETE(req("DELETE"), {
      params: Promise.resolve({ tripId, shareId: share.value.shareId }),
    });
    currentUserId = "";
    expect(
      (await PUBLIC_GET(req(), { params: Promise.resolve({ token: share.value.token }) })).status,
    ).toBe(410);
  });
});
