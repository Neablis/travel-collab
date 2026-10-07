import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AddActivity, TripPreview } from "@tc/contracts";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { upsertUser } from "@/server/users";
import { acceptInvite, createInvite, revokeInvite } from "@/server/access/invites";
import { requireTripAccess } from "@/server/access/trip-access";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

// `GET /api/invites/:token/preview` — M38's gate box for D4: *the token-scoped
// read returns nothing that decision 4 hides*. Through the ROUTE, because the
// route's `.strict()` parse is half of that rule — what this file reads is
// what actually leaves.

// Never signed in: the token is the whole authority here. Mocked rather than
// left real because `next-auth` does not load under vitest, and the look read
// below imports the seam that would call it.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const { GET } = await import("./route");

const run = randomUUID().slice(0, 8);
const OWNER = `dev-preview-owner-${run}`;
const GUEST = `dev-preview-guest-${run}`;

async function preview(token: string): Promise<{ status: number; raw: string }> {
  const response = await GET(new Request("http://test/x"), { params: Promise.resolve({ token }) });
  return { status: response.status, raw: await response.text() };
}

async function command(cmd: { type: string; tripId: string } & Record<string, unknown>): Promise<void> {
  const result = await executeTripCommand(cmd, OWNER);
  if (!result.ok) throw new Error(`failed to seed: ${cmd.type}`);
}

async function addStop(tripId: string, stop: Omit<AddActivity, "type" | "tripId" | "activityId">): Promise<void> {
  await command({ type: "AddActivity", tripId, activityId: randomUUID(), ...stop });
}

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

/** Every path in `value` whose key is `key`-like, dotted from the root. */
function pathsWhere(value: unknown, test: (key: string, leaf: unknown) => boolean, at = ""): string[] {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = Array.isArray(value) ? `${at}[${key}]` : at === "" ? key : `${at}.${key}`;
    return [...(test(key, child) ? [path] : []), ...pathsWhere(child, test, path)];
  });
}

beforeAll(async () => {
  // Entitled so the guest's grant is not capped — this file is about D4, not
  // entitlements (see invites.int.test.ts).
  await entitleAccounts([OWNER]);
  await db
    .update(users)
    .set({ name: "Dana Reyes", email: "dana@example.com", displayName: "Dana", avatar: "compass", color: "moss" })
    .where(eq(users.id, OWNER));
  await upsertUser({ id: GUEST, name: "Mei Tanaka", email: "mei@example.com", image: null });
});

describe("GET /api/invites/:token/preview — a pending invite", () => {
  it("shows the route, the people and the total, and no per-stop or per-person amount", async () => {
    const tripId = randomUUID();
    await command({ type: "CreateTrip", tripId, name: "Kyoto in autumn" });
    const day1 = randomUUID();
    const day2 = randomUUID();
    await command({ type: "AddDay", tripId, dayId: day1 });
    await command({ type: "AddDay", tripId, dayId: day2 });
    await command({ type: "SetTripStartDate", tripId, startDate: "2026-11-02" });
    // The guest joins first, so a stop can be split between two people.
    expect((await acceptInvite((await createInvite(tripId, OWNER, { email: null, role: "editor" })).token, GUEST)).ok).toBe(true);

    // Costs of every shape the board prices: a stop split to one person and
    // booked by another, a stop priced for every traveller, and a backlog idea.
    const kyoto = { name: "Fushimi Inari", city: "Kyoto", lat: 34.9671, lng: 135.7727, precision: "venue" as const };
    await addStop(tripId, {
      dayId: day1,
      title: "Fushimi Inari",
      location: kyoto,
      cost: usd(1500),
      participants: [OWNER],
      bookedBy: GUEST,
    });
    await addStop(tripId, { dayId: day1, title: "Tea ceremony", cost: usd(4000) });
    await addStop(tripId, { dayId: day2, title: "Wander Gion" });
    await addStop(tripId, { title: "Sake tasting, maybe", cost: usd(1000) });

    const invite = await createInvite(tripId, OWNER, { email: "sam@example.com", role: "viewer" });
    const { status, raw } = await preview(invite.token);
    expect(status).toBe(200);
    const body = JSON.parse(raw) as TripPreview;

    // 1500 × 1 picked + 4000 × 2 travellers + 1000 × 2 in the backlog. And it
    // is the board's number, not a second sum: the same figure *Have a look
    // first* reads through the trip-access seam.
    const look = await requireTripAccess(tripId, "viewer", { inviteToken: invite.token });
    if (!("detail" in look)) throw new Error("the look read refused a pending token");
    expect(body.total).toEqual(usd(11_500));
    expect(body.total.amountMinor).toBe(look.detail.tripCostTotal);

    expect(body).toEqual({
      name: "Kyoto in autumn",
      startDate: "2026-11-02",
      endDate: "2026-11-03",
      days: [
        {
          date: "2026-11-02",
          city: "Kyoto",
          stops: [
            { title: "Fushimi Inari", location: kyoto },
            { title: "Tea ceremony", location: null },
          ],
        },
        { date: "2026-11-03", city: null, stops: [{ title: "Wander Gion", location: null }] },
      ],
      people: [
        { name: "Dana", avatar: "compass", color: "moss", travelling: true },
        { name: "Mei Tanaka", avatar: null, color: null, travelling: true },
      ],
      total: usd(11_500),
    });

    // D4, by walking the payload rather than trusting the `toEqual` above to
    // be kept in step with a schema that grows: no money-shaped key at any
    // depth except the total, and no number that is not a coordinate or the
    // total — so a cost under a name nobody thought to forbid still fails.
    const MONEY = /cost|amount|price|total|budget|balance|owe|paid|split|share/i;
    expect(pathsWhere(body, (key) => MONEY.test(key))).toEqual(["total", "total.amountMinor"]);
    expect(
      pathsWhere(body, (key, leaf) => typeof leaf === "number" && key !== "lat" && key !== "lng"),
    ).toEqual(["total.amountMinor"]);
    // Who is in a stop, and who booked it, are the per-person half.
    expect(pathsWhere(body, (key) => /participants|bookedBy/.test(key))).toEqual([]);

    // Names carry no address, and nobody is named by an id (ADR-027).
    expect(raw).not.toContain("@");
    for (const secret of [OWNER, GUEST, invite.token, tripId]) expect(raw).not.toContain(secret);
  });
});

describe("GET /api/invites/:token/preview — a refused link carries nothing", () => {
  async function pendingInvite() {
    const tripId = randomUUID();
    await command({ type: "CreateTrip", tripId, name: "Kyoto in autumn" });
    return { tripId, invite: await createInvite(tripId, OWNER, { email: null, role: "editor" }) };
  }

  it("answers a revoked invite 410 with an empty body", async () => {
    const { tripId, invite } = await pendingInvite();
    await revokeInvite(tripId, invite.inviteId);
    expect(await preview(invite.token)).toEqual({ status: 410, raw: "" });
  });

  it("answers an accepted invite 410 with an empty body", async () => {
    const { invite } = await pendingInvite();
    expect((await acceptInvite(invite.token, GUEST)).ok).toBe(true);
    expect(await preview(invite.token)).toEqual({ status: 410, raw: "" });
  });

  it("answers an unknown token 404 with an empty body", async () => {
    expect(await preview("no-such-token")).toEqual({ status: 404, raw: "" });
  });

  it("answers a deleted trip's invite 410", async () => {
    const { tripId, invite } = await pendingInvite();
    await command({ type: "DeleteTrip", tripId });
    expect(await preview(invite.token)).toEqual({ status: 410, raw: "" });
  });
});
