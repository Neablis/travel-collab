// The chat collection and the read cursor (M46 part 1). Who may use the chat
// at all — removal, lapse, demo, a deleted trip — is `server/chat/chat.int.test.ts`.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatPage } from "@tc/contracts";
import { db } from "@/server/db/client";
import { executeTripCommand } from "@/server/commands";
import { grantMembership } from "@/server/access/members";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET, POST } = await import("./route");
const read = await import("./read/route");

const newUser = () => `dev-chatroute-${randomUUID()}`;
const params = (tripId: string) => ({ params: Promise.resolve({ tripId }) });

async function sharedTrip() {
  const owner = newUser();
  const viewer = newUser();
  await entitleAccounts([owner]);
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Porto" }, owner);
  if (!created.ok) throw new Error("failed to seed trip");
  await grantMembership(db, { tripId, userId: viewer, role: "viewer", invitedBy: owner, now: new Date().toISOString() });
  return { tripId, owner, viewer };
}

async function page(tripId: string, as: string): Promise<ChatPage> {
  currentUserId = as;
  const res = await GET(new Request("http://test/x"), params(tripId));
  expect(res.status).toBe(200);
  return (await res.json()) as ChatPage;
}

async function post(tripId: string, as: string, body: unknown) {
  currentUserId = as;
  return POST(new Request("http://test/x", { method: "POST", body: JSON.stringify(body) }), params(tripId));
}

async function posted(tripId: string, as: string, body: unknown): Promise<ChatMessage> {
  const res = await post(tripId, as, body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { message: ChatMessage }).message;
}

async function markRead(tripId: string, as: string, messageId: string) {
  currentUserId = as;
  return read.POST(new Request("http://test/x", { method: "POST", body: JSON.stringify({ messageId }) }), params(tripId));
}

beforeEach(() => {
  currentUserId = "";
});

describe("GET and POST /api/trips/:tripId/chat", () => {
  it("401s without a session and 403s a stranger", async () => {
    const { tripId } = await sharedTrip();
    expect((await GET(new Request("http://test/x"), params(tripId))).status).toBe(401);
    currentUserId = newUser();
    expect((await GET(new Request("http://test/x"), params(tripId))).status).toBe(403);
    expect((await post(tripId, newUser(), { body: "hi" })).status).toBe(403);
  });

  // D2: a viewer is a member of the conversation, not an audience.
  it("lets a viewer post, and serves messages oldest first with their author and link", async () => {
    const { tripId, owner, viewer } = await sharedTrip();
    const dayId = randomUUID();
    await posted(tripId, owner, { body: "First" });
    await posted(tripId, viewer, { body: "  Second  ", link: { kind: "day", id: dayId } });

    const { messages, canPost, hasEarlier } = await page(tripId, viewer);
    expect(canPost).toBe(true);
    expect(hasEarlier).toBe(false);
    expect(messages).toMatchObject([
      { authorId: owner, body: "First", removed: false },
      { authorId: viewer, body: "Second", removed: false, link: { kind: "day", id: dayId } },
    ]);
    expect(messages[0]).not.toHaveProperty("link");
  });

  it("refuses an empty body with a 400 and stores nothing", async () => {
    const { tripId, owner } = await sharedTrip();
    expect((await post(tripId, owner, { body: "   " })).status).toBe(400);
    expect((await page(tripId, owner)).messages).toEqual([]);
  });
});

describe("unread and the read cursor", () => {
  it("counts other people's messages after the cursor, never your own", async () => {
    const { tripId, owner, viewer } = await sharedTrip();
    const first = await posted(tripId, owner, { body: "One" });
    await posted(tripId, owner, { body: "Two" });
    await posted(tripId, viewer, { body: "Mine" });

    expect((await page(tripId, viewer)).unread).toBe(2);
    expect((await page(tripId, owner)).unread).toBe(1);

    expect((await markRead(tripId, viewer, first.messageId)).status).toBe(204);
    expect((await page(tripId, viewer)).unread).toBe(1);
  });

  // Two tabs: the one behind must not make read messages unread again.
  it("never moves the cursor backwards", async () => {
    const { tripId, owner, viewer } = await sharedTrip();
    const first = await posted(tripId, owner, { body: "One" });
    const second = await posted(tripId, owner, { body: "Two" });
    await markRead(tripId, viewer, second.messageId);
    await markRead(tripId, viewer, first.messageId);
    expect((await page(tripId, viewer)).unread).toBe(0);
  });

  it("404s a message that is not on this trip", async () => {
    const { tripId, owner } = await sharedTrip();
    const other = await sharedTrip();
    const elsewhere = await posted(other.tripId, other.owner, { body: "Elsewhere" });
    expect((await markRead(tripId, owner, elsewhere.messageId)).status).toBe(404);
  });
});
