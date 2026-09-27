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
