// Editing and deleting one message (M46 D6): the author edits their own; the
// author deletes their own and the owner any; a delete is soft.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatPage } from "@tc/contracts";
import { db } from "@/server/db/client";
import { tripMessages } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { grantMembership } from "@/server/access/members";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { PATCH, DELETE } = await import("./route");
const collection = await import("../route");

const newUser = () => `dev-chatmsg-${randomUUID()}`;

async function sharedTrip() {
  const owner = newUser();
  const editor = newUser();
  const viewer = newUser();
  await entitleAccounts([owner]);
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Seville" }, owner);
  if (!created.ok) throw new Error("failed to seed trip");
  const now = new Date().toISOString();
  await grantMembership(db, { tripId, userId: editor, role: "editor", invitedBy: owner, now });
  await grantMembership(db, { tripId, userId: viewer, role: "viewer", invitedBy: owner, now });
  return { tripId, owner, editor, viewer };
}

async function posted(tripId: string, as: string, body: string): Promise<ChatMessage> {
  currentUserId = as;
  const res = await collection.POST(
    new Request("http://test/x", { method: "POST", body: JSON.stringify({ body, link: { kind: "stop", id: randomUUID() } }) }),
    { params: Promise.resolve({ tripId }) },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { message: ChatMessage }).message;
}

const at = (tripId: string, messageId: string) => ({ params: Promise.resolve({ tripId, messageId }) });

function edit(tripId: string, messageId: string, as: string, body: string) {
  currentUserId = as;
  return PATCH(new Request("http://test/x", { method: "PATCH", body: JSON.stringify({ body }) }), at(tripId, messageId));
}

function remove(tripId: string, messageId: string, as: string) {
  currentUserId = as;
  return DELETE(new Request("http://test/x", { method: "DELETE" }), at(tripId, messageId));
}

async function listed(tripId: string, as: string): Promise<ChatMessage[]> {
  currentUserId = as;
  const res = await collection.GET(new Request("http://test/x"), { params: Promise.resolve({ tripId }) });
  return ((await res.json()) as ChatPage).messages;
}

beforeEach(() => {
  currentUserId = "";
});

describe("PATCH /api/trips/:tripId/chat/:messageId", () => {
  it("lets the author change their text and marks it edited", async () => {
    const { tripId, viewer } = await sharedTrip();
    const message = await posted(tripId, viewer, "Meet at 9");
    const res = await edit(tripId, message.messageId, viewer, "Meet at 10");
    expect(res.status).toBe(200);
    const { message: edited } = (await res.json()) as { message: ChatMessage };
    expect(edited).toMatchObject({ removed: false, body: "Meet at 10", editedAt: expect.any(String) });
  });

  // Not even the owner rewrites what somebody else said.
  it("refuses anyone but the author, the owner included", async () => {
    const { tripId, owner, viewer } = await sharedTrip();
    const message = await posted(tripId, viewer, "Mine");
    expect((await edit(tripId, message.messageId, owner, "Theirs now")).status).toBe(403);
  });

  it("refuses to edit a removed message", async () => {
    const { tripId, viewer } = await sharedTrip();
    const message = await posted(tripId, viewer, "Gone soon");
    expect((await remove(tripId, message.messageId, viewer)).status).toBe(200);
    expect((await edit(tripId, message.messageId, viewer, "Back")).status).toBe(409);
  });

  it("404s a message id that is not a uuid", async () => {
    const { tripId, owner } = await sharedTrip();
    expect((await edit(tripId, "not-a-uuid", owner, "Here")).status).toBe(404);
  });

  it("404s a message from another trip", async () => {
    const one = await sharedTrip();
    const two = await sharedTrip();
    const message = await posted(two.tripId, two.owner, "Elsewhere");
    expect((await edit(one.tripId, message.messageId, one.owner, "Here")).status).toBe(404);
  });
});

describe("DELETE /api/trips/:tripId/chat/:messageId", () => {
  it("lets the author delete their own, and serves it as removed with no text", async () => {
    const { tripId, editor, viewer } = await sharedTrip();
    const message = await posted(tripId, editor, "Oops");
    expect((await remove(tripId, message.messageId, editor)).status).toBe(200);

    const [served] = await listed(tripId, viewer);
    expect(served).toEqual({
      messageId: message.messageId,
      authorId: editor,
      createdAt: message.createdAt,
      editedAt: null,
      removed: true,
    });
    // Soft: the row is kept, with who removed it.
    const [row] = await db.select().from(tripMessages).where(eq(tripMessages.id, message.messageId));
    expect(row).toMatchObject({ body: "Oops", deletedBy: editor });
  });

  it("lets the owner delete anyone's, and nobody else delete someone else's", async () => {
    const { tripId, owner, editor, viewer } = await sharedTrip();
    const message = await posted(tripId, viewer, "Hmm");
    expect((await remove(tripId, message.messageId, editor)).status).toBe(403);
    expect((await remove(tripId, message.messageId, owner)).status).toBe(200);
    expect((await listed(tripId, viewer))[0]).toMatchObject({ removed: true });
  });
});
