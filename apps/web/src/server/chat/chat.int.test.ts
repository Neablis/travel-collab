// M46's server gate boxes (ADR-073), through the routes a client calls:
//
//   * a conversation leaves the trip's event log exactly as it was;
//   * a removed member can neither read nor post from their next request;
//   * after the owner's lapse the chat reads, marks read and deletes, and
//     refuses a post or an edit, by name;
//   * the demo and a deleted trip are refused, and a restore brings it back;
//   * every chat write moves `chatRev` on the events poll, for every reader.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatPage, TripEventsPage } from "@tc/contracts";
import { db } from "@/server/db/client";
import { tripMessages, users } from "@/server/db/schema";
import { unreadByTrip } from "@/server/chat/messages";
import { executeTripCommand } from "@/server/commands";
import { readStream } from "@/server/eventStore";
import { grantMembership } from "@/server/access/members";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const chat = await import("@/app/api/trips/[tripId]/chat/route");
const oneMessage = await import("@/app/api/trips/[tripId]/chat/[messageId]/route");
const read = await import("@/app/api/trips/[tripId]/chat/read/route");
const events = await import("@/app/api/trips/[tripId]/events/route");
const members = await import("@/app/api/trips/[tripId]/members/[userId]/route");

const newUser = () => `dev-chat-${randomUUID()}`;

/** A trip whose owner is entitled, with one editor and one viewer. */
async function sharedTrip() {
  const owner = newUser();
  const editor = newUser();
  const viewer = newUser();
  await entitleAccounts([owner]);
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Lisbon" }, owner);
  if (!created.ok) throw new Error("failed to seed trip");
  const now = new Date().toISOString();
  await grantMembership(db, { tripId, userId: editor, role: "editor", invitedBy: owner, now });
  await grantMembership(db, { tripId, userId: viewer, role: "viewer", invitedBy: owner, now });
  return { tripId, owner, editor, viewer };
}

const tripParams = (tripId: string) => ({ params: Promise.resolve({ tripId }) });

async function list(tripId: string, as: string) {
  currentUserId = as;
  return chat.GET(new Request(`http://test/api/trips/${tripId}/chat`), tripParams(tripId));
}

async function post(tripId: string, as: string, body: unknown) {
  currentUserId = as;
  return chat.POST(
    new Request(`http://test/api/trips/${tripId}/chat`, { method: "POST", body: JSON.stringify(body) }),
    tripParams(tripId),
  );
}

async function posted(tripId: string, as: string, text: string): Promise<ChatMessage> {
  const res = await post(tripId, as, { body: text });
  expect(res.status).toBe(201);
  return ((await res.json()) as { message: ChatMessage }).message;
}

async function chatRev(tripId: string, as: string): Promise<string | undefined> {
  currentUserId = as;
  const res = await events.GET(new Request(`http://test/api/trips/${tripId}/events?after=0`), tripParams(tripId));
  expect(res.status).toBe(200);
  return ((await res.json()) as TripEventsPage).chatRev;
}

beforeEach(() => {
  currentUserId = "";
});

describe("the event log", () => {
  // ADR-073 §1, the gate's first server box. Posting, editing, deleting and
  // reading are a whole conversation; the stream must not know it happened.
  it("is identical before and after a conversation", async () => {
    const { tripId, owner, editor, viewer } = await sharedTrip();
    const before = await readStream(db, tripId);

    const first = await posted(tripId, owner, "Dinner on the first night?");
    const second = await posted(tripId, viewer, "Yes, somewhere in Alfama");
    await posted(tripId, editor, "I'll book it");
    currentUserId = viewer;
    const edited = await oneMessage.PATCH(
      new Request("http://test/x", { method: "PATCH", body: JSON.stringify({ body: "Yes, Alfama please" }) }),
      { params: Promise.resolve({ tripId, messageId: second.messageId }) },
    );
    expect(edited.status).toBe(200);
    currentUserId = owner;
    const deleted = await oneMessage.DELETE(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ tripId, messageId: first.messageId }),
    });
    expect(deleted.status).toBe(200);
    currentUserId = editor;
    const marked = await read.POST(
      new Request("http://test/x", { method: "POST", body: JSON.stringify({ messageId: second.messageId }) }),
      tripParams(tripId),
    );
    expect(marked.status).toBe(204);

    expect(await readStream(db, tripId)).toEqual(before);
  });
});

describe("a removed member", () => {
  // The gate's second server box: every request re-asks the access seam, so
  // the request after the removal is refused, with no session to tear down.
  it("can neither read nor post from their next request", async () => {
    const { tripId, owner, editor } = await sharedTrip();
    await posted(tripId, editor, "Before I was removed");
    expect((await list(tripId, editor)).status).toBe(200);

    currentUserId = owner;
    const removed = await members.DELETE(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ tripId, userId: editor }),
    });
    expect(removed.status).toBe(200);

    expect((await list(tripId, editor)).status).toBe(403);
    expect((await post(tripId, editor, { body: "Am I still here?" })).status).toBe(403);
    // And nothing they tried reached the conversation.
    const page = (await (await list(tripId, owner)).json()) as ChatPage;
    expect(page.messages).toHaveLength(1);
  });
});

describe("after the owner's lapse", () => {
  // D2: the chat stays readable for everyone and nobody may post, the owner
  // included, with the collaboration gate's own code.
  it("is readable and refuses a post with a named code", async () => {
    const { tripId, owner, editor, viewer } = await sharedTrip();
    await posted(tripId, editor, "Booked the flights");

    await db.update(users).set({ planId: "free" }).where(eq(users.id, owner));

    for (const member of [owner, editor, viewer]) {
      const res = await list(tripId, member);
      expect(res.status).toBe(200);
      const page = (await res.json()) as ChatPage;
      expect(page.messages.map((m) => (m.removed ? null : m.body))).toEqual(["Booked the flights"]);
      expect(page.canPost).toBe(false);
      expect(page.readOnlyReason).toBe("collaborators-not-entitled");

      const refused = await post(tripId, member, { body: "Anyone?" });
      expect(refused.status).toBe(402);
      expect(await refused.json()).toMatchObject({ code: "collaborators-not-entitled" });
    }
  });

  // Read-only is for new content: an edit is refused like a post, but marking
  // read is reading, and a delete is moderation, which a lapse must not stop.
  it("refuses an edit, and still marks read and lets the author and the owner delete", async () => {
    const { tripId, owner, editor, viewer } = await sharedTrip();
    const editors = await posted(tripId, editor, "Booked the flights");
    const viewers = await posted(tripId, viewer, "Something regrettable");
    const owners = await posted(tripId, owner, "Hotel is sorted");

    await db.update(users).set({ planId: "free" }).where(eq(users.id, owner));

    currentUserId = editor;
    const edited = await oneMessage.PATCH(
      new Request("http://test/x", { method: "PATCH", body: JSON.stringify({ body: "Booked the trains" }) }),
      { params: Promise.resolve({ tripId, messageId: editors.messageId }) },
    );
    expect(edited.status).toBe(402);
    expect(await edited.json()).toMatchObject({ code: "collaborators-not-entitled" });

    const marked = await read.POST(
      new Request("http://test/x", { method: "POST", body: JSON.stringify({ messageId: owners.messageId }) }),
      tripParams(tripId),
    );
    expect(marked.status).toBe(204);
    expect(((await (await list(tripId, editor)).json()) as ChatPage).unread).toBe(0);

    const remove = (messageId: string, as: string) => {
      currentUserId = as;
      return oneMessage.DELETE(new Request("http://test/x", { method: "DELETE" }), {
        params: Promise.resolve({ tripId, messageId }),
      });
    };
    // Still nobody else's to delete but the owner's.
    expect((await remove(owners.messageId, viewer)).status).toBe(403);
    expect((await remove(editors.messageId, editor)).status).toBe(200);
    expect((await remove(viewers.messageId, owner)).status).toBe(200);

    const page = (await (await list(tripId, owner)).json()) as ChatPage;
    expect(page.messages.map((m) => (m.removed ? null : m.body))).toEqual([null, null, "Hotel is sorted"]);
  });
});

describe("a trip the chat does not serve", () => {
  it("refuses the demo trip on every route, by name", async () => {
    currentUserId = newUser();
    const messageId = randomUUID();
    const at = { params: Promise.resolve({ tripId: DEMO_TRIP_ID, messageId }) };
    const json = (method: string, body: unknown) =>
      new Request("http://test/x", { method, body: JSON.stringify(body) });
    const answers = [
      await chat.GET(new Request("http://test/x"), tripParams(DEMO_TRIP_ID)),
      await chat.POST(json("POST", { body: "hi" }), tripParams(DEMO_TRIP_ID)),
      await oneMessage.PATCH(json("PATCH", { body: "hi" }), at),
      await oneMessage.DELETE(new Request("http://test/x", { method: "DELETE" }), at),
      await read.POST(json("POST", { messageId }), tripParams(DEMO_TRIP_ID)),
    ];
    for (const res of answers) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "demo-trip-unsupported" });
    }
  });

  // ADR-073 §5: hidden while the trip is deleted, never purged.
  it("hides a deleted trip's chat and brings it back on restore", async () => {
    const { tripId, owner, viewer } = await sharedTrip();
    await posted(tripId, viewer, "See you there");

    expect((await executeTripCommand({ type: "DeleteTrip", tripId }, owner)).ok).toBe(true);
    expect((await list(tripId, viewer)).status).toBe(404);
    expect((await post(tripId, owner, { body: "Still here?" })).status).toBe(404);

    expect((await executeTripCommand({ type: "RestoreTrip", tripId }, owner)).ok).toBe(true);
    const page = (await (await list(tripId, viewer)).json()) as ChatPage;
    expect(page.messages.map((m) => (m.removed ? null : m.body))).toEqual(["See you there"]);
  });
});

describe("chatRev on the events poll", () => {
  // ADR-073 §2: every write moves it, and every reader is served it.
  it("moves on a post, an edit and a delete, on a viewer's poll", async () => {
    const { tripId, owner, editor, viewer } = await sharedTrip();
    const seen = [await chatRev(tripId, viewer)];
    expect(seen[0]).toBe("0");

    const message = await posted(tripId, editor, "Train or bus?");
    seen.push(await chatRev(tripId, viewer));

    currentUserId = editor;
    await oneMessage.PATCH(
      new Request("http://test/x", { method: "PATCH", body: JSON.stringify({ body: "Train?" }) }),
      { params: Promise.resolve({ tripId, messageId: message.messageId }) },
    );
    seen.push(await chatRev(tripId, viewer));

    currentUserId = owner;
    await oneMessage.DELETE(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ tripId, messageId: message.messageId }),
    });
    seen.push(await chatRev(tripId, viewer));

    expect(new Set(seen).size).toBe(4);
  });

  it("does not move when a write is refused", async () => {
    const { tripId, owner, viewer } = await sharedTrip();
    await posted(tripId, viewer, "One");
    const before = await chatRev(tripId, viewer);
    await db.update(users).set({ planId: "free" }).where(eq(users.id, owner));
    expect((await post(tripId, viewer, { body: "Two" })).status).toBe(402);
    expect(await chatRev(tripId, viewer)).toBe(before);
  });
});

describe("unreadByTrip", () => {
  // D5's Home half: the panel's own rule, for a whole grid at once. Which
  // trips the reader may see is the caller's to decide; this only counts.
  it("counts other people's live messages after the reader's cursor, trip by trip", async () => {
    const lisbon = await sharedTrip();
    const porto = await sharedTrip();
    const quiet = await sharedTrip();
    const first = await posted(lisbon.tripId, lisbon.editor, "Flights booked");
    await posted(lisbon.tripId, lisbon.viewer, "Hotel too");
    await posted(lisbon.tripId, lisbon.owner, "My own, never unread to me");
    const deleted = await posted(lisbon.tripId, lisbon.editor, "Deleted before I saw it");
    const hidden = await posted(lisbon.tripId, lisbon.viewer, "Hidden by an admin");
    await posted(porto.tripId, porto.editor, "Porto next?");

    currentUserId = lisbon.editor;
    const removed = await oneMessage.DELETE(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ tripId: lisbon.tripId, messageId: deleted.messageId }),
    });
    expect(removed.status).toBe(200);
    // No route hides a message yet (part 5's admin panel); the column is what it reads.
    await db.update(tripMessages).set({ hiddenAt: new Date() }).where(eq(tripMessages.id, hidden.messageId));

    const counts = await unreadByTrip(lisbon.owner, [lisbon.tripId, porto.tripId, quiet.tripId]);
    expect(counts.get(lisbon.tripId)).toBe(2);
    expect(counts.get(porto.tripId)).toBe(1);
    expect(counts.get(quiet.tripId) ?? 0).toBe(0);

    currentUserId = lisbon.owner;
    const marked = await read.POST(
      new Request("http://test/x", { method: "POST", body: JSON.stringify({ messageId: first.messageId }) }),
      tripParams(lisbon.tripId),
    );
    expect(marked.status).toBe(204);
    expect((await unreadByTrip(lisbon.owner, [lisbon.tripId])).get(lisbon.tripId)).toBe(1);
  });

  it("is one statement for the whole list, and none for an empty one", async () => {
    const trips = [await sharedTrip(), await sharedTrip(), await sharedTrip()];
    for (const t of trips) await posted(t.tripId, t.editor, "Hello");
    const spy = vi.spyOn(db.$client, "query");
    try {
      spy.mockClear();
      const counts = await unreadByTrip(trips[0]!.owner, trips.map((t) => t.tripId));
      expect(spy.mock.calls.length).toBe(1);
      expect(counts.get(trips[0]!.tripId)).toBe(1);

      spy.mockClear();
      expect((await unreadByTrip(trips[0]!.owner, [])).size).toBe(0);
      expect(spy.mock.calls.length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
