// M46 D6's moderation half (ADR-073 §4), through the routes a client and an
// operator call: a member reports a message on a trip they can read, the
// queue shows it, and the operator's hide and restore act on the row, moving
// `chatRev` so every open page re-reads.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminReportAction, ChatMessage, ChatPage, CreateReportInput, TripEventsPage } from "@tc/contracts";
import type { AdminReportsResponse, CreateReportResponse } from "@/lib/reports";
import { db } from "@/server/db/client";
import { contentReports, users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { grantMembership } from "@/server/access/members";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { upsertUser } from "@/server/users";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const chat = await import("@/app/api/trips/[tripId]/chat/route");
const events = await import("@/app/api/trips/[tripId]/events/route");
const reports = await import("@/app/api/reports/route");
const queue = await import("@/app/api/admin/reports/route");
const act = await import("@/app/api/admin/reports/[reportId]/route");

const newUser = () => `dev-chatmod-${randomUUID()}`;
const ADMIN = newUser();
await upsertUser({ id: ADMIN, email: `${ADMIN}@example.test`, name: null, image: null });
await db.update(users).set({ isAdmin: true }).where(eq(users.id, ADMIN));

/** A trip whose owner is entitled, with one viewer, and a message from each. */
async function conversation() {
  const owner = newUser();
  const viewer = newUser();
  await entitleAccounts([owner]);
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Porto" }, owner);
  if (!created.ok) throw new Error("failed to seed trip");
  await grantMembership(db, { tripId, userId: viewer, role: "viewer", invitedBy: owner, now: new Date().toISOString() });
  const owners = await posted(tripId, owner, "Dinner at eight");
  const viewers = await posted(tripId, viewer, "Something regrettable");
  return { tripId, owner, viewer, owners, viewers };
}

const tripParams = (tripId: string) => ({ params: Promise.resolve({ tripId }) });

async function posted(tripId: string, as: string, body: string): Promise<ChatMessage> {
  currentUserId = as;
  const res = await chat.POST(
    new Request(`http://test/api/trips/${tripId}/chat`, { method: "POST", body: JSON.stringify({ body }) }),
    tripParams(tripId),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { message: ChatMessage }).message;
}

async function page(tripId: string, as: string): Promise<ChatPage> {
  currentUserId = as;
  return (await chat.GET(new Request(`http://test/api/trips/${tripId}/chat`), tripParams(tripId))).json() as Promise<ChatPage>;
}

async function chatRev(tripId: string, as: string): Promise<string | undefined> {
  currentUserId = as;
  const res = await events.GET(new Request(`http://test/api/trips/${tripId}/events?after=0`), tripParams(tripId));
  return ((await res.json()) as TripEventsPage).chatRev;
}

function report(as: string, tripId: string, messageId: string) {
  currentUserId = as;
  const input: CreateReportInput = { target: { kind: "trip_message", tripId, messageId }, reason: "offensive", note: null };
  return reports.POST(new Request("http://test/api/reports", { method: "POST", body: JSON.stringify(input) }));
}

async function filed(as: string, tripId: string, messageId: string) {
  const res = await report(as, tripId, messageId);
  expect(res.status).toBe(201);
  return ((await res.json()) as CreateReportResponse).report;
}

function decide(reportId: string, action: AdminReportAction) {
  currentUserId = ADMIN;
  return act.POST(new Request("http://test/x", { method: "POST", body: JSON.stringify(action) }), {
    params: Promise.resolve({ reportId }),
  });
}

async function openQueue(): Promise<AdminReportsResponse> {
  currentUserId = ADMIN;
  return (await queue.GET(new Request("http://test/api/admin/reports?status=open"))).json() as Promise<AdminReportsResponse>;
}

beforeEach(() => {
  currentUserId = "";
});

describe("reporting a trip message", () => {
  it("is stored for a member of the trip, once per reporter, and shows the message in the queue", async () => {
    const { tripId, owner, viewer, viewers } = await conversation();
    const stored = await filed(owner, tripId, viewers.messageId);
    expect(stored.target).toEqual({ kind: "trip_message", tripId, messageId: viewers.messageId });

    const rows = await db.select().from(contentReports).where(eq(contentReports.id, stored.reportId));
    expect(rows.map((r) => [r.targetKind, r.tripId, r.tripMessageId, r.savedDayId])).toEqual([
      ["trip_message", tripId, viewers.messageId, null],
    ]);
    expect((await report(owner, tripId, viewers.messageId)).status).toBe(200);

    const item = (await openQueue()).reports.find((r) => r.report.reportId === stored.reportId);
    expect(item?.message).toMatchObject({ authorId: viewer, body: "Something regrettable", hiddenAt: null });
    expect(item?.reportsOnTarget).toBe(1);
  });

  // What you cannot read, you cannot report — or learn exists: a stranger, a
  // message named under the wrong trip and a removed one all answer 404.
  it("is not-found for a stranger, the wrong trip and a removed message, and refuses your own", async () => {
    const { tripId, owner, viewer, owners, viewers } = await conversation();
    const other = await conversation();
    expect((await report(newUser(), tripId, viewers.messageId)).status).toBe(404);
    // A member of both trips, so the 404 is the message's trip filter and not
    // the access check: filed under `other`, this trip's words would reach the
    // queue, and a hide would bump the wrong trip's chatRev.
    await grantMembership(db, { tripId: other.tripId, userId: owner, role: "viewer", invitedBy: other.owner, now: new Date().toISOString() });
    expect((await report(owner, other.tripId, viewers.messageId)).status).toBe(404);
    expect((await report(viewer, tripId, viewers.messageId)).status).toBe(403);

    currentUserId = owner;
    const oneMessage = await import("@/app/api/trips/[tripId]/chat/[messageId]/route");
    await oneMessage.DELETE(new Request("http://test/x", { method: "DELETE" }), {
      params: Promise.resolve({ tripId, messageId: viewers.messageId }),
    });
    expect((await report(owner, tripId, viewers.messageId)).status).toBe(404);
    expect((await report(viewer, tripId, owners.messageId)).status).toBe(201);
  });
});

describe("an operator's decision on a message", () => {
  it("hides it for every member, moving chatRev, and a restore brings the words back", async () => {
    const { tripId, owner, viewer, viewers } = await conversation();
    const stored = await filed(owner, tripId, viewers.messageId);
    const before = await chatRev(tripId, viewer);

    expect((await decide(stored.reportId, { action: "hide-message" })).status).toBe(200);
    const hidden = (await page(tripId, viewer)).messages.find((m) => m.messageId === viewers.messageId);
    expect(hidden).toMatchObject({ removed: true });
    expect(hidden).not.toHaveProperty("body");
    const afterHide = await chatRev(tripId, viewer);
    expect(afterHide).not.toBe(before);

    const [settled] = await db.select().from(contentReports).where(eq(contentReports.id, stored.reportId));
    expect([settled!.status, settled!.resolvedBy]).toEqual(["actioned", ADMIN]);

    expect((await decide(stored.reportId, { action: "restore-message" })).status).toBe(200);
    const back = (await page(tripId, owner)).messages.find((m) => m.messageId === viewers.messageId);
    expect(back).toMatchObject({ removed: false, body: "Something regrettable" });
    expect(await chatRev(tripId, viewer)).not.toBe(afterHide);
  });

  // The other direction, a message's action on a day report, is in
  // `app/api/reports/route.int.test.ts`, which has the day to report.
  it("refuses a day's or a review's action on a message report", async () => {
    const { tripId, owner, viewers } = await conversation();
    const stored = await filed(owner, tripId, viewers.messageId);
    expect((await decide(stored.reportId, { action: "hide-day" })).status).toBe(400);
    expect((await decide(stored.reportId, { action: "hide-review" })).status).toBe(400);
  });
});
