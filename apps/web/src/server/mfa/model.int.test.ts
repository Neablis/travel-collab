import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { authConfig, createJwtCallback } from "@/lib/authConfig";
import { bumpSecurityEpoch, mfaStateFor, mintSecondFactorProof, readSecondFactorProof } from "./state";

// Only the Auth.js wrapper is replaced, by one that hands the handler whatever
// `auth` the test sets: what is under test is the claims, the lookup against a
// real row, and the proxy's own branch on the result.
const current = vi.hoisted(() => ({ auth: null as unknown }));
vi.mock("next-auth", () => ({
  default: () => ({
    auth: (handler: (req: unknown) => Response) => (req: NextRequest) =>
      handler(Object.assign(req, { auth: current.auth })),
  }),
}));
const { default: proxy } = await import("@/proxy");

// The callback `server/auth.ts` builds, over the real tables.
const jwt = createJwtCallback({
  stateFor: mfaStateFor,
  secondFactorFrom: (userId, payload, epoch) => readSecondFactorProof(userId, payload, epoch, new Date()),
}) as unknown as (a: unknown) => Promise<Record<string, unknown> | null>;
const sessionOf = (token: Record<string, unknown>) =>
  (authConfig.callbacks!.session as unknown as (a: unknown) => unknown)({ session: { user: {} }, token });

async function account(mfaOn: boolean) {
  const id = `dev-${randomUUID()}`;
  const now = new Date().toISOString();
  await db.insert(users).values({ id, createdAt: now, updatedAt: now, mfaEnabledAt: mfaOn ? new Date() : null });
  return id;
}
const signIn = (id: string) => jwt({ token: {}, user: { id }, account: { providerAccountId: id } });

function visit(path: string): Response {
  const req = new NextRequest(new URL(path, "https://caesura.test"));
  return (proxy as unknown as (r: NextRequest) => Response)(req);
}

describe("Model: a second factor, carried in the token and revoked by the epoch", () => {
  it("sends an MFA account with only its first factor to /signin/verify from an app route", async () => {
    const id = await account(true);
    current.auth = sessionOf((await signIn(id))!);
    const res = visit("/trips/abc?tab=days");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe(
      "/signin/verify?callbackUrl=%2Ftrips%2Fabc%3Ftab%3Ddays",
    );
  });

  it("lets the same account in once a server-minted proof has added a second factor", async () => {
    const id = await account(true);
    const token = (await signIn(id))!;
    const { epoch } = await mfaStateFor(id);
    const upgraded = await jwt({
      token,
      trigger: "update",
      session: mintSecondFactorProof(id, "webauthn", epoch, new Date()),
    });
    expect(upgraded).toMatchObject({ amr: ["google", "webauthn"] });
    current.auth = sessionOf(upgraded!);
    expect(visit("/trips/abc").headers.get("location")).toBeNull();
  });

  it("does not believe an update the browser made up", async () => {
    const id = await account(true);
    const token = (await signIn(id))!;
    const forged = await jwt({
      token,
      trigger: "update",
      session: { method: "webauthn", epoch: 0, expiresAt: Date.now() + 60_000, proof: "0".repeat(64) },
    });
    current.auth = sessionOf(forged!);
    expect(visit("/home").status).toBe(307);
  });

  it("refuses a proof from before the epoch moved, and one that has expired", async () => {
    const id = await account(true);
    const token = (await signIn(id))!;
    const { epoch } = await mfaStateFor(id);
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
    const expired = mintSecondFactorProof(id, "otp", epoch, minutesAgo(3));
    expect(await jwt({ token, trigger: "update", session: expired })).toMatchObject({ amr: ["google"] });
    const stale = mintSecondFactorProof(id, "otp", epoch, new Date());
    await bumpSecurityEpoch(id);
    expect(await jwt({ token, trigger: "update", session: stale })).toBeNull();
  });

  it("leaves an account without MFA alone", async () => {
    const id = await account(false);
    current.auth = sessionOf((await signIn(id))!);
    expect(visit("/home").headers.get("location")).toBeNull();
  });

  it("refuses a token under an older security epoch, and keeps the session that made the change", async () => {
    const id = await account(true);
    const other = (await signIn(id))!;
    const changing = (await signIn(id))!;
    const epoch = await bumpSecurityEpoch(id);
    expect(await jwt({ token: other })).toBeNull();
    const renewed = await jwt({
      token: changing,
      trigger: "update",
      session: mintSecondFactorProof(id, "otp", epoch, new Date()),
    });
    expect(renewed).toMatchObject({ epoch, amr: ["google", "otp"] });
    expect(await jwt({ token: renewed! })).not.toBeNull();
  });
});
