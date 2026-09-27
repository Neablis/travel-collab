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
const { PATCH } = await import("../[pageId]/route");

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

const post = (url: string) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

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

// A seed renamed away from its template's title is not recognised
// (KI-2026-09-27-e), so "Add missing" seeds the template again beside it.
// Renaming the first one back then collides with the second on
// `pages_system_seed_unique`, which escaped as a 500. It is the ordinary 409,
// saying which name is taken.
describe("renaming a seed onto a title another seed holds", () => {
  beforeEach(() => {
    currentUserId = "";
  });

  it("is the ordinary 409, naming the notebook", async () => {
    const { tripId, ownerId } = await sharedTrip();
    currentUserId = ownerId;
    const money = (await listPages(tripId)).find((p) => p.title === "Money")!;
    const rename = (title: string) =>
      PATCH(
        new Request(`http://test/api/trips/${tripId}/pages/${money.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }),
        { params: Promise.resolve({ tripId, pageId: money.id }) },
      );
    expect((await rename("Budget")).status).toBe(200);
    const added = await ADD_MISSING(post(`http://test/api/trips/${tripId}/pages/defaults`), { params: Promise.resolve({ tripId }) });
    expect(added.status).toBe(200);

    const res = await rename("Money");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "A notebook called “Money” already exists in this trip." });
  });
});
