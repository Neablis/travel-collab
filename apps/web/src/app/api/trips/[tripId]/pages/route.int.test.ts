import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";

const ACTOR_ID = "user-1";
const OUTSIDER_ID = "user-2";

let currentUserId = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the routes pick up the mocked `auth`.
const { GET, POST } = await import("./route");
const { GET: GET_ITEM, PATCH, DELETE } = await import("./[pageId]/route");

async function seedTrip() {
  const tripId = randomUUID();
  const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, ACTOR_ID);
  if (!result.ok) throw new Error("failed to seed trip");
  return tripId;
}

// No DB truncation: every test seeds its own randomUUID() tripId/pageId and
// every assertion reads back through those ids — see
// eventStore.int.test.ts's comment and docs/testing-baseline.md (Phase 2
// Task 2.6). currentUserId still resets every test — that's mock auth state,
// not DB state.
describe("/api/trips/:id/pages", () => {
  beforeEach(() => {
    currentUserId = ACTOR_ID;
  });

  describe("GET list / POST create", () => {
    it("401s when unauthenticated", async () => {
      const tripId = await seedTrip();
      currentUserId = "";
      const req = new Request(`http://test/api/trips/${tripId}/pages`);
      const res = await GET(req, { params: Promise.resolve({ tripId }) });
      expect(res.status).toBe(401);
    });

    it("403s for a non-member", async () => {
      const tripId = await seedTrip();
      currentUserId = OUTSIDER_ID;
      const req = new Request(`http://test/api/trips/${tripId}/pages`);
      const res = await GET(req, { params: Promise.resolve({ tripId }) });
      expect(res.status).toBe(403);
    });

    it("returns the two lazily-instantiated default pages for a member", async () => {
      const tripId = await seedTrip();
      const req = new Request(`http://test/api/trips/${tripId}/pages`);
      const res = await GET(req, { params: Promise.resolve({ tripId }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pages).toHaveLength(2);
    });

    it("creates a page", async () => {
      const tripId = await seedTrip();
      const req = new Request(`http://test/api/trips/${tripId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Notes",
          context: { tripId },
          content: { type: "doc", content: [] },
        }),
      });
      const res = await POST(req, { params: Promise.resolve({ tripId }) });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.page.title).toBe("Notes");
      expect(body.page.tripId).toBe(tripId);
    });

    it("rejects a create whose context.tripId doesn't match the URL", async () => {
      const tripId = await seedTrip();
      const req = new Request(`http://test/api/trips/${tripId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Notes",
          context: { tripId: randomUUID() },
          content: { type: "doc", content: [] },
        }),
      });
      const res = await POST(req, { params: Promise.resolve({ tripId }) });
      expect(res.status).toBe(400);
    });
  });

  describe("GET item / PATCH / DELETE", () => {
    async function seedPage(tripId: string) {
      const req = new Request(`http://test/api/trips/${tripId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Notes",
          context: { tripId },
          content: { type: "doc", content: [] },
        }),
      });
      const res = await POST(req, { params: Promise.resolve({ tripId }) });
      const body = await res.json();
      return body.page.id as string;
    }

    it("401s when unauthenticated", async () => {
      const tripId = await seedTrip();
      const pageId = await seedPage(tripId);
      currentUserId = "";
      const req = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`);
      const res = await GET_ITEM(req, { params: Promise.resolve({ tripId, pageId }) });
      expect(res.status).toBe(401);
    });

    it("403s for a non-member", async () => {
      const tripId = await seedTrip();
      const pageId = await seedPage(tripId);
      currentUserId = OUTSIDER_ID;
      const req = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`);
      const res = await GET_ITEM(req, { params: Promise.resolve({ tripId, pageId }) });
      expect(res.status).toBe(403);
    });

    it("gets a single page", async () => {
      const tripId = await seedTrip();
      const pageId = await seedPage(tripId);
      const req = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`);
      const res = await GET_ITEM(req, { params: Promise.resolve({ tripId, pageId }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.page.id).toBe(pageId);
    });

    it("404s when the page belongs to a different trip", async () => {
      const tripId = await seedTrip();
      const otherTripId = await seedTrip();
      const pageId = await seedPage(otherTripId);
      const req = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`);
      const res = await GET_ITEM(req, { params: Promise.resolve({ tripId, pageId }) });
      expect(res.status).toBe(404);
    });

    it("updates a page", async () => {
      const tripId = await seedTrip();
      const pageId = await seedPage(tripId);
      const req = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ tripId, pageId }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.page.title).toBe("Renamed");
    });

    it("deletes a page", async () => {
      const tripId = await seedTrip();
      const pageId = await seedPage(tripId);
      const req = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, { method: "DELETE" });
      const res = await DELETE(req, { params: Promise.resolve({ tripId, pageId }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const getReq = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`);
      const getRes = await GET_ITEM(getReq, { params: Promise.resolve({ tripId, pageId }) });
      expect(getRes.status).toBe(404);
    });

    it("404s a PATCH on a page belonging to a different trip", async () => {
      const tripId = await seedTrip();
      const otherTripId = await seedTrip();
      const pageId = await seedPage(otherTripId);
      const req = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ tripId, pageId }) });
      expect(res.status).toBe(404);
    });

    it("404s a DELETE on a page belonging to a different trip", async () => {
      const tripId = await seedTrip();
      const otherTripId = await seedTrip();
      const pageId = await seedPage(otherTripId);
      const req = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, { method: "DELETE" });
      const res = await DELETE(req, { params: Promise.resolve({ tripId, pageId }) });
      expect(res.status).toBe(404);

      // Confirm it wasn't actually deleted (still fetchable from its real trip).
      const getReq = new Request(`http://test/api/trips/${otherTripId}/pages/${pageId}`);
      const getRes = await GET_ITEM(getReq, { params: Promise.resolve({ tripId: otherTripId, pageId }) });
      expect(getRes.status).toBe(200);
    });

    it("400s a PATCH with a body that fails UpdatePageInput validation", async () => {
      const tripId = await seedTrip();
      const pageId = await seedPage(tripId);
      const req = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // title must be a non-empty string per UpdatePageInput.
        body: JSON.stringify({ title: "" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ tripId, pageId }) });
      expect(res.status).toBe(400);
    });

    it("400s a PATCH that tries to reparent the page via a mismatched context.tripId", async () => {
      const tripId = await seedTrip();
      const pageId = await seedPage(tripId);
      const req = new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { tripId: randomUUID() } }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ tripId, pageId }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/tripId/i);
    });
  });
});
