import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { commandsFor } from "@tc/factories";
import { db } from "@/server/db/client";
import { inviteCodes, users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { upsertUser } from "@/server/users";
import { acceptInvite, createInvite, revokeInvite } from "@/server/access/invites";
import { mintReferralCode } from "@/server/entitlements/referrals";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { inviteCardFor } from "./invite";
import { referrerFirstNameFor } from "./referral";

// The link-preview lookups (spec 2026-09-27 §2.3). What is under test is the
// privacy rule: a stranger holding a link learns a FIRST name, and a revoked or
// spent invite stops naming anybody. "Dana Reyes" with an address is seeded so
// the surname and the email are both there to leak.

const run = randomUUID().slice(0, 8);
const OWNER = `dev-og-owner-${run}`;
const GUESTS = [
  { id: `dev-og-mei-${run}`, name: "Mei Tanaka" },
  { id: `dev-og-priya-${run}`, name: "Priya Shah" },
  { id: `dev-og-kenji-${run}`, name: "Kenji Mori" },
];

async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Japan: Tokyo → Kyoto" }, OWNER);
  if (!created.ok) throw new Error("failed to seed trip");
  for (const command of commandsFor("threeDayTrip", tripId, { startDate: "2027-06-01" })) {
    const result = await executeTripCommand(command, OWNER);
    if (!result.ok) throw new Error(`failed to seed ${command.type}`);
  }
  return tripId;
}

beforeAll(async () => {
  await entitleAccounts([OWNER]);
  await db.update(users).set({ name: "Dana Reyes", email: "dana@example.com" }).where(eq(users.id, OWNER));
  for (const guest of GUESTS) {
    await upsertUser({ id: guest.id, name: guest.name, email: `${guest.id}@example.com`, image: null });
  }
});

describe("inviteCardFor", () => {
  it("names a pending invite's sender by first name only, with the trip and its crew", async () => {
    const tripId = await seedTrip();
    for (const guest of GUESTS) {
      const earlier = await createInvite(tripId, OWNER, { email: null, role: "editor" });
      expect((await acceptInvite(earlier.token, guest.id)).ok).toBe(true);
    }
    const invite = await createInvite(tripId, OWNER, { email: "sam@example.com", role: "editor" });

    const card = await inviteCardFor(invite.token);

    expect(card).toEqual({
      kind: "personal",
      inviterFirstName: "Dana",
      tripName: "Japan: Tokyo → Kyoto",
      startDate: "2027-06-01",
      dayCount: 3,
      cityCount: 3,
      crew: ["Dana", "Mei", "Priya"],
      crewOverflow: 1,
    });
    const printed = JSON.stringify(card);
    for (const leak of ["Reyes", "Tanaka", "Shah", "Mori", "@", "sam"]) expect(printed).not.toContain(leak);
  });

  it("gives a revoked invite the generic card", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    await revokeInvite(tripId, invite.inviteId);

    expect(await inviteCardFor(invite.token)).toEqual({ kind: "generic" });
  });

  it("gives an accepted invite the generic card", async () => {
    const tripId = await seedTrip();
    const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
    expect((await acceptInvite(invite.token, GUESTS[0]!.id)).ok).toBe(true);

    expect(await inviteCardFor(invite.token)).toEqual({ kind: "generic" });
  });

  it("gives an unknown token the generic card", async () => {
    expect(await inviteCardFor(`no-such-token-${run}`)).toEqual({ kind: "generic" });
  });
});

describe("referrerFirstNameFor", () => {
  it("names the referrer by first name, before and after the code is redeemed", async () => {
    const minted = await mintReferralCode(OWNER);
    if (!minted.ok) throw new Error(minted.reason);

    expect(await referrerFirstNameFor(minted.code)).toBe("Dana");

    await db
      .update(inviteCodes)
      .set({ redeemedBy: GUESTS[0]!.id, redeemedAt: new Date() })
      .where(eq(inviteCodes.code, minted.code));
    expect(await referrerFirstNameFor(minted.code)).toBe("Dana");
  });

  it("answers null for a code nobody minted", async () => {
    expect(await referrerFirstNameFor(`NOPE${run}`)).toBeNull();
  });

  it("answers null for a referrer with no name, rather than a made-up handle", async () => {
    const nameless = `dev-og-nameless-${run}`;
    await upsertUser({ id: nameless, name: null, email: "someone@example.com", image: null });
    const minted = await mintReferralCode(nameless);
    if (!minted.ok) throw new Error(minted.reason);

    expect(await referrerFirstNameFor(minted.code)).toBeNull();
  });
});
