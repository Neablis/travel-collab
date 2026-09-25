import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CURRENT_PAGE_DOC_VERSION, PAGE_TITLE_MAX, PageDoc, collectPageDocNodeTypes } from "@tc/contracts";
import { DEFAULT_TEMPLATES, TEMPLATE_LIBRARY } from "@tc/pages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { MAX_PAGE_BODY_BYTES } from "@/server/pages";

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

    // One seeded page since SPEC §25, not two. Counted off `DEFAULT_TEMPLATES`
    // so the next change to what a trip is seeded with is one edit.
    it("returns the lazily-instantiated default pages for a member", async () => {
      const tripId = await seedTrip();
      const req = new Request(`http://test/api/trips/${tripId}/pages`);
      const res = await GET(req, { params: Promise.resolve({ tripId }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pages).toHaveLength(DEFAULT_TEMPLATES.length);
      expect(body.pages[0].context.kind).toBe("overview");
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

    // The stale-save guard, as the editor meets it: a 409 carrying a code the
    // client can tell apart from a stream conflict, which it retries, while
    // this one it must not (CodeRabbit, PR #222).
    it("409s a PATCH typed against an older revision, with page-changed", async () => {
      const tripId = await seedTrip();
      const pageId = await seedPage(tripId);
      const send = (body: unknown) =>
        PATCH(
          new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ tripId, pageId }) },
        );
      const r0 = ((await (await send({ title: "First" })).json()) as { page: { updatedAt: string } }).page.updatedAt;
      const r1 = ((await (await send({ title: "Second", expectedUpdatedAt: r0 })).json()) as { page: { updatedAt: string } })
        .page.updatedAt;
      expect(r1).not.toBe(r0);

      const res = await send({ title: "Third", expectedUpdatedAt: r0 });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "This page changed since you opened it.", code: "page-changed" });
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

    // KI-2026-09-05-x. `pages.id` is a uuid column, so before the guard these
    // three answered 500 — `22P02 invalid input syntax for type uuid` escaping
    // `getPage` — for a mistyped or truncated page link. 404, not 400: a
    // malformed id and an id naming nothing are the same fact to whoever
    // followed the link.
    describe.each([
      ["GET", (tripId: string, pageId: string) =>
        GET_ITEM(new Request(`http://test/api/trips/${tripId}/pages/${pageId}`), {
          params: Promise.resolve({ tripId, pageId }),
        })],
      ["PATCH", (tripId: string, pageId: string) =>
        PATCH(
          new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Renamed" }),
          }),
          { params: Promise.resolve({ tripId, pageId }) },
        )],
      ["DELETE", (tripId: string, pageId: string) =>
        DELETE(new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, { method: "DELETE" }), {
          params: Promise.resolve({ tripId, pageId }),
        })],
    ])("%s with a pageId that is not a uuid", (_method, call) => {
      it("404s instead of reaching Postgres", async () => {
        const tripId = await seedTrip();
        await seedPage(tripId);
        const res = await call(tripId, "not-a-uuid");
        expect(res.status).toBe(404);
      });
    });

    // The trip half of the same KI, asserted through a real route rather than
    // at the seam: `requireTripAccess` reads `trip_details` by a uuid tripId,
    // and every trip-scoped route inherits whatever it answers.
    it("404s a tripId that is not a uuid, rather than 500ing", async () => {
      const req = new Request("http://test/api/trips/not-a-uuid/pages");
      const res = await GET(req, { params: Promise.resolve({ tripId: "not-a-uuid" }) });
      expect(res.status).toBe(404);
    });
  });

  // KI-2026-09-05-g (F-B09 + F-B01). The write path used to store the Zod
  // OUTPUT — so a node this build does not know was saved as its in-memory
  // `{type:"unknown",raw}` wrapper and wrapped again on every later read — and
  // it checked no widget name, so the registry and `attribute`'s allow-list
  // were enforced only in the browser.
  describe("the write path stores the canonical document and checks every widget", () => {
    const doc = (...content: unknown[]) => ({ v: CURRENT_PAGE_DOC_VERSION, type: "doc", content });
    const widget = (name: string, params: Record<string, unknown> = {}) => ({
      type: "paragraph",
      content: [{ type: "macro", attrs: { name, params } }],
    });

    async function create(tripId: string, content: unknown, title = "Notes") {
      return POST(
        new Request(`http://test/api/trips/${tripId}/pages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, context: { tripId }, content }),
        }),
        { params: Promise.resolve({ tripId }) },
      );
    }

    async function patch(tripId: string, pageId: string, content: unknown) {
      return PATCH(
        new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }),
        { params: Promise.resolve({ tripId, pageId }) },
      );
    }

    async function read(tripId: string, pageId: string) {
      const res = await GET_ITEM(new Request(`http://test/api/trips/${tripId}/pages/${pageId}`), {
        params: Promise.resolve({ tripId, pageId }),
      });
      return (await res.json()).page as { content: { v: number; content: unknown[] } };
    }

    async function seedEmpty(tripId: string) {
      const res = await create(tripId, doc());
      return ((await res.json()).page.id) as string;
    }

    it("carries a node this build does not know back out verbatim, across repeated saves", async () => {
      const tripId = await seedTrip();
      const pageId = await seedEmpty(tripId);
      const future = { type: "futureNode", foo: 1 };
      const sent = doc({ type: "paragraph", content: [{ type: "text", text: "hi" }] }, future);

      expect((await patch(tripId, pageId, sent)).status).toBe(200);
      const first = await read(tripId, pageId);
      expect(first.content.content[1]).toEqual(future);

      // The autosave loop: what the client read is what it writes back. Before
      // the fix this is where the wrapper nested a second time.
      expect((await patch(tripId, pageId, first.content)).status).toBe(200);
      const second = await read(tripId, pageId);
      expect(second.content.content[1]).toEqual(future);
      expect(collectPageDocNodeTypes(PageDoc.parse(second.content))).toContain("futureNode");
    });

    it("carries an unknown node verbatim on create too", async () => {
      const tripId = await seedTrip();
      const future = { type: "futureNode", foo: 1 };
      const res = await create(tripId, doc(future));
      expect(res.status).toBe(201);
      const pageId = (await res.json()).page.id as string;
      expect((await read(tripId, pageId)).content.content[0]).toEqual(future);
    });

    it("stamps a document written without a version at the current one", async () => {
      const tripId = await seedTrip();
      const pageId = await seedEmpty(tripId);
      expect((await patch(tripId, pageId, { type: "doc", content: [] })).status).toBe(200);
      expect((await read(tripId, pageId)).content.v).toBe(CURRENT_PAGE_DOC_VERSION);
    });

    it("400s a document from a version this build does not understand, on PATCH and POST", async () => {
      const tripId = await seedTrip();
      const pageId = await seedEmpty(tripId);
      const future = { v: CURRENT_PAGE_DOC_VERSION + 1, type: "doc", content: [] };
      expect((await patch(tripId, pageId, future)).status).toBe(400);
      expect((await read(tripId, pageId)).content.v).toBe(CURRENT_PAGE_DOC_VERSION);
      expect((await create(tripId, future)).status).toBe(400);
    });

    it.each([
      ["an unregistered widget", widget("nope.nope")],
      ["an attribute outside the allow-list", widget("attribute", { field: "account.email" })],
      ["a filter the widget does not select by", widget("city.rows", { kind: "pending" })],
    ])("400s %s, on PATCH and POST, and stores nothing", async (_label, node) => {
      const tripId = await seedTrip();
      const pageId = await seedEmpty(tripId);
      const res = await patch(tripId, pageId, doc(node));
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty("error");
      expect((await read(tripId, pageId)).content.content).toEqual([]);
      expect((await create(tripId, doc(node))).status).toBe(400);
    });

    it("still accepts a registered widget with legal params", async () => {
      const tripId = await seedTrip();
      const pageId = await seedEmpty(tripId);
      expect((await patch(tripId, pageId, doc(widget("cost", { kind: "pending" })))).status).toBe(200);
      expect((await patch(tripId, pageId, doc(widget("attribute", { field: "trip.name" })))).status).toBe(200);
    });

    // A stricter write must not refuse the app's own documents: every template
    // the gallery offers and every notebook the content bundle ships is created
    // through exactly this route.
    const bundle = JSON.parse(
      readFileSync(resolve(process.cwd(), "../../content/notebooks/built-in-notebooks.json"), "utf8"),
    ) as { notebooks: { key: string; title: string; content: unknown }[] };
    it.each([
      ...[...DEFAULT_TEMPLATES, ...TEMPLATE_LIBRARY].map((t) => [`template ${t.key}`, t.title, t.content] as const),
      ...bundle.notebooks.map((n) => [`bundled notebook ${n.key}`, n.title, n.content] as const),
    ])("saves the shipped %s", async (_label, title, content) => {
      const tripId = await seedTrip();
      const res = await create(tripId, content, title);
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    });
  });
});

// KI-2026-09-05-f item 1 (F-A02, the 2026-08-28 review's L5). A page's title
// and document had no bound on the write path, so an editor could store pages
// as large as the platform would carry. The body is capped in BYTES before it
// is parsed (`MAX_PAGE_BODY_BYTES`, the `/ask` pattern) and the title in
// characters (`PAGE_TITLE_MAX`). Read paths are deliberately untouched — a page
// already stored larger must still load.
describe("a notebook write is bounded", () => {
  beforeEach(() => {
    currentUserId = ACTOR_ID;
  });

  // One paragraph whose text pads the serialized body to exactly `bytes`.
  const bodyOfSize = (tripId: string, bytes: number, title = "Notes") => {
    const shell = (text: string) =>
      JSON.stringify({
        title,
        context: { tripId },
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
      });
    return shell("x".repeat(Math.max(1, bytes - shell("").length)));
  };
  const post = (tripId: string, body: string) =>
    POST(
      new Request(`http://test/api/trips/${tripId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
      { params: Promise.resolve({ tripId }) },
    );
  const patch = (tripId: string, pageId: string, body: string) =>
    PATCH(
      new Request(`http://test/api/trips/${tripId}/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
      }),
      { params: Promise.resolve({ tripId, pageId }) },
    );
  const read = async (tripId: string, pageId: string) => {
    const res = await GET_ITEM(new Request(`http://test/api/trips/${tripId}/pages/${pageId}`), {
      params: Promise.resolve({ tripId, pageId }),
    });
    return (await res.json()).page as { title: string; content: { content: unknown[] } };
  };
  const pageCount = async (tripId: string) => {
    const res = await GET(new Request(`http://test/api/trips/${tripId}/pages`), { params: Promise.resolve({ tripId }) });
    return ((await res.json()).pages as unknown[]).length;
  };

  it("413s a PATCH over the byte cap and leaves the page as it was", async () => {
    const tripId = await seedTrip();
    const created = await post(tripId, bodyOfSize(tripId, 1_000));
    const pageId = (await created.json()).page.id as string;
    const before = await read(tripId, pageId);

    const res = await patch(tripId, pageId, bodyOfSize(tripId, MAX_PAGE_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: expect.stringContaining(MAX_PAGE_BODY_BYTES.toLocaleString("en-US")) });
    expect(await read(tripId, pageId)).toEqual(before);
  });

  it("413s a POST over the byte cap and creates nothing", async () => {
    const tripId = await seedTrip();
    const before = await pageCount(tripId);
    expect((await post(tripId, bodyOfSize(tripId, MAX_PAGE_BODY_BYTES + 1))).status).toBe(413);
    expect(await pageCount(tripId)).toBe(before);
  });

  // The other side of the line: a cap that also refused a body AT the limit
  // would pass both tests above.
  it("accepts a body exactly at the cap", async () => {
    const tripId = await seedTrip();
    const body = bodyOfSize(tripId, MAX_PAGE_BODY_BYTES);
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_PAGE_BODY_BYTES);
    expect((await post(tripId, body)).status).toBe(201);
  });

  it(`400s a title over ${PAGE_TITLE_MAX} characters, on POST and PATCH, and accepts one at it`, async () => {
    const tripId = await seedTrip();
    const atMax = "t".repeat(PAGE_TITLE_MAX);
    const tooLong = "t".repeat(PAGE_TITLE_MAX + 1);
    expect((await post(tripId, bodyOfSize(tripId, 500, tooLong))).status).toBe(400);

    const created = await post(tripId, bodyOfSize(tripId, 500, atMax));
    expect(created.status).toBe(201);
    const pageId = (await created.json()).page.id as string;
    expect((await patch(tripId, pageId, JSON.stringify({ title: tooLong }))).status).toBe(400);
    expect((await read(tripId, pageId)).title).toBe(atMax);
  });
});
