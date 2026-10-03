// The HTTP face of the default-notebook actions: owner only, and a refusal is
// the repo's ordinary 403 (`{ error: "forbidden" }`, from the access seam)
// rather than a new shape. What each action DOES is `defaultNotebooks.int.test.ts`'s;
// this is only who gets through the door and what the door answers.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { grantMembership } from "@/server/access/members";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { listPages } from "@/server/pages";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Imported after the mock so the routes pick up the mocked `auth`.
const { POST: ADD_MISSING } = await import("./route");
const { POST: RESET } = await import("../[pageId]/reset/route");
const { PATCH, DELETE } = await import("../[pageId]/route");

async function sharedTrip() {
  const ownerId = `owner-${randomUUID()}`;
  await entitleAccounts([ownerId]); // so granted collaborators keep their role (M20)
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Porto 2028" }, ownerId);
  const now = new Date().toISOString();
  const editorId = `editor-${randomUUID()}`;
  const viewerId = `viewer-${randomUUID()}`;
  await grantMembership(db, { tripId, userId: editorId, role: "editor", invitedBy: ownerId, now });
  await grantMembership(db, { tripId, userId: viewerId, role: "viewer", invitedBy: ownerId, now });
  const overview = (await listPages(tripId)).find((p) => p.context.kind === "overview")!;
  return { tripId, ownerId, editorId, viewerId, pageId: overview.id };
}

const post = (url: string, body: unknown = {}) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("the default-notebook routes", () => {
  beforeEach(() => {
    currentUserId = "";
  });

  it("answer an editor and a viewer with the ordinary 403, and the owner with the result", async () => {
    const { tripId, ownerId, editorId, viewerId, pageId } = await sharedTrip();
    const calls = [
      () => ADD_MISSING(post(`http://test/api/trips/${tripId}/pages/defaults`), { params: Promise.resolve({ tripId }) }),
      () => RESET(post(`http://test/api/trips/${tripId}/pages/${pageId}/reset`), { params: Promise.resolve({ tripId, pageId }) }),
    ];

    for (const actor of [editorId, viewerId]) {
      currentUserId = actor;
      for (const call of calls) {
        const res = await call();
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden" });
      }
    }

    currentUserId = ownerId;
    for (const call of calls) expect((await call()).status).toBe(200);
  });
});

// A link card to a missing default names the one it wants (Mitchell,
// 2026-10-03). The body reaches the command: a route that dropped it would add
// every missing default, which is the index's button, not the card's.
describe("POST /pages/defaults with a seed key", () => {
  it("adds that default only, and refuses a body that is not one", async () => {
    const { tripId, ownerId } = await sharedTrip();
    currentUserId = ownerId;
    const url = `http://test/api/trips/${tripId}/pages/defaults`;
    for (const page of (await listPages(tripId)).filter((p) => p.context.kind !== "overview")) {
      const res = await DELETE(new Request(url, { method: "DELETE" }), { params: Promise.resolve({ tripId, pageId: page.id }) });
      expect(res.status).toBe(200);
    }

    const bad = await ADD_MISSING(post(url, { seedKey: 7 }), { params: Promise.resolve({ tripId }) });
    expect(bad.status).toBe(400);

    const res = await ADD_MISSING(post(url, { seedKey: "money" }), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pages: { seedKey?: string }[] };
    expect(body.pages.map((p) => p.seedKey).sort()).toEqual(["money", "overview"]);
  });
});

// Titles are free (Mitchell, 2026-09-27): a default is known by its seed key,
// so any notebook may take any name, including one another notebook has. Until
// then the seed index was on (trip, title), and renaming "Before you go" to
// "Money" was refused as 409 `page-title-taken`.
describe("renaming a notebook onto a name another notebook has", () => {
  beforeEach(() => {
    currentUserId = "";
  });

  it("is allowed, and each keeps being the default it was", async () => {
    const { tripId, ownerId } = await sharedTrip();
    currentUserId = ownerId;
    const beforeYouGo = (await listPages(tripId)).find((p) => p.seedKey === "before-you-go")!;
    const res = await PATCH(
      new Request(`http://test/api/trips/${tripId}/pages/${beforeYouGo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Money" }),
      }),
      { params: Promise.resolve({ tripId, pageId: beforeYouGo.id }) },
    );
    expect(res.status).toBe(200);

    const named = (await listPages(tripId)).filter((p) => p.title === "Money");
    expect(named.map((p) => p.seedKey).sort()).toEqual(["before-you-go", "money"]);
  });
});
