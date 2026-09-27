import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { commandsFor } from "@tc/factories";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { createInvite, revokeInvite } from "@/server/access/invites";
import { mintReferralCode } from "@/server/entitlements/referrals";
import { entitleAccounts } from "@/server/test-support/entitledAccount";
import { GET as inviteImage } from "./invite/[token]/route";
import { GET as inviteMeta } from "./invite/[token]/meta/route";
import { GET as referralImage } from "./referral/[code]/route";
import { GET as referralMeta } from "./referral/[code]/meta/route";

// The preview routes (spec 2026-09-27 §2.3): each state answers a real PNG at
// the size chat apps expect, and the meta sibling carries the title the
// unfurler prints beside it. What the lookups return is `server/og/og.int.test.ts`;
// this is what leaves over HTTP.

const run = randomUUID().slice(0, 8);
const OWNER = `dev-og-routes-owner-${run}`;
const TRIP_NAME = "Japan: Tokyo → Kyoto";

let pendingToken = "";
let revokedToken = "";
let referralCode = "";

const request = new Request("http://test/x");
const withToken = (token: string) => ({ params: Promise.resolve({ token }) });
const withCode = (code: string) => ({ params: Promise.resolve({ code }) });

/** The width and height a PNG declares in its IHDR chunk. */
async function pngSize(response: Response): Promise<{ width: number; height: number }> {
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

beforeAll(async () => {
  await entitleAccounts([OWNER]);
  await db.update(users).set({ name: "Dana Reyes", email: "dana@example.com" }).where(eq(users.id, OWNER));
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: TRIP_NAME }, OWNER);
  if (!created.ok) throw new Error("failed to seed trip");
  for (const command of commandsFor("threeDayTrip", tripId, { startDate: "2027-06-01" })) {
    if (!(await executeTripCommand(command, OWNER)).ok) throw new Error(`failed to seed ${command.type}`);
  }
  pendingToken = (await createInvite(tripId, OWNER, { email: null, role: "editor" })).token;
  const revoked = await createInvite(tripId, OWNER, { email: null, role: "editor" });
  await revokeInvite(tripId, revoked.inviteId);
  revokedToken = revoked.token;
  const minted = await mintReferralCode(OWNER);
  if (!minted.ok) throw new Error(minted.reason);
  referralCode = minted.code;
});

describe("GET /api/og/invite/:token", () => {
  it.each([
    ["a pending invite", () => pendingToken],
    ["a revoked invite", () => revokedToken],
    ["an unknown token", () => `no-such-token-${run}`],
  ])("draws %s as a 1200×630 PNG with the short cache header", async (_state, token) => {
    const response = await inviteImage(request, withToken(token()));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    expect(await pngSize(response)).toEqual({ width: 1200, height: 630 });
  });
});

describe("GET /api/og/invite/:token/meta", () => {
  it("titles a pending invite with the inviter's first name and the trip", async () => {
    const response = await inviteMeta(request, withToken(pendingToken));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { title: string; description: string };
    expect(body.title).toBe(`Dana invited you to plan ${TRIP_NAME}`);
    expect(body.description).toBe("Jun 1, 2027 – Jun 3, 2027 · 3 days · 3 cities · with Dana");
  });

  it("titles a revoked invite generically, naming nobody", async () => {
    const response = await inviteMeta(request, withToken(revokedToken));

    const body = (await response.json()) as { title: string; description: string };
    expect(body.title).toBe("You're invited to a trip on Caesura");
    expect(JSON.stringify(body)).not.toContain("Dana");
  });
});

describe("GET /api/og/referral/:code", () => {
  it.each([
    ["a known code", () => referralCode],
    ["an unknown code", () => `NOPE${run}`],
  ])("draws %s as a 1200×630 PNG", async (_state, code) => {
    const response = await referralImage(request, withCode(code()));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await pngSize(response)).toEqual({ width: 1200, height: 630 });
  });
});

describe("GET /api/og/referral/:code/meta", () => {
  it("titles a known code with the referrer's first name", async () => {
    const response = await referralMeta(request, withCode(referralCode));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      title: "Dana invited you to Caesura",
      description: "Trips, planned together",
    });
  });

  it("answers 404 for a code that names nobody, so the page keeps the site card", async () => {
    const response = await referralMeta(request, withCode(`NOPE${run}`));

    expect(response.status).toBe(404);
  });
});
