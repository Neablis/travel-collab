// **An invite with an address is emailed; one without is not.** The link is
// still the invite either way — this only asserts the courtesy send.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { upsertUser } from "@/server/users";
import { sendEmail } from "@/server/email/send";
import { POST } from "./route";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));
vi.mock("@/server/email/send", () => ({ sendEmail: vi.fn(async () => ({ sent: true, id: "msg_1" })) }));

/** A premium owner — the collaboration gate is not what this suite is about. */
async function ownerWithTrip(): Promise<{ ownerId: string; tripId: string }> {
  const ownerId = `dev-${randomUUID()}`;
  await upsertUser({ id: ownerId, email: "owner@gmail.com", name: "Google Name", image: null });
  await db.update(users).set({ planId: "premium", planVersion: 1, displayName: "Ana" }).where(eq(users.id, ownerId));
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto 2028" }, ownerId);
  if (!created.ok) throw new Error("failed to seed trip");
  return { ownerId, tripId };
}

function invite(tripId: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/trips/${tripId}/invites`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ tripId }) },
  );
}

describe("POST /api/trips/:tripId/invites — email", () => {
  beforeEach(() => vi.mocked(sendEmail).mockClear());

  it("emails an invite that has an address: the trip, the link, and a reply-to the owner", async () => {
    const { ownerId, tripId } = await ownerWithTrip();
    currentUserId = ownerId;

    const res = await invite(tripId, { email: "Friend@Gmail.com", role: "editor" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emailed).toBe(true);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(mail).toMatchObject({
      tag: "trip-invite",
      to: "friend@gmail.com",
      subject: "Ana invited you to Kyoto 2028",
      replyTo: "owner@gmail.com",
    });
    expect(mail.text).toContain(`/invite/${body.invite.token}`);
  });

  it("sends nothing for a link-only invite", async () => {
    const { ownerId, tripId } = await ownerWithTrip();
    currentUserId = ownerId;

    const res = await invite(tripId, { email: null, role: "viewer" });
    expect(res.status).toBe(201);
    expect((await res.json()).emailed).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

// Travellers spec D3: the invite carries whether its taker joins as a
// traveller. The preset itself is `createInvite`'s (invites.int.test.ts); this
// proves the body field reaches it, and that leaving it out is what presets.
describe("POST /api/trips/:tripId/invites — travelling", () => {
  it("stores the choice the body names, over the role's preset", async () => {
    const { ownerId, tripId } = await ownerWithTrip();
    currentUserId = ownerId;

    const res = await invite(tripId, { email: null, role: "viewer", travelling: true });

    expect(res.status).toBe(201);
    expect((await res.json()).invite.travelling).toBe(true);
  });

  it("presets it from the role when the body leaves it out", async () => {
    const { ownerId, tripId } = await ownerWithTrip();
    currentUserId = ownerId;

    const res = await invite(tripId, { email: null, role: "viewer" });

    expect(res.status).toBe(201);
    expect((await res.json()).invite.travelling).toBe(false);
  });
});
