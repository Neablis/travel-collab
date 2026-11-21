import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { authConfig } from "@/lib/authConfig";
import { bumpSecurityEpoch, mfaStateFor, mintSecondFactorProof } from "./state";

// Only the Auth.js wrapper is replaced: by one that hands the proxy's handler
// whatever `auth` the test sets, and keeps the config each instance was built
// from. What is under test is the claims, the lookup against a real row, and the
// proxy's own branch on the result; the `jwt` callback is the one `server/auth.ts`
// really wires, so deleting its override there turns these red.
const mocked = vi.hoisted(() => ({
  auth: null as unknown,
  configs: [] as { callbacks?: { jwt?: unknown; signIn?: unknown } }[],
}));
vi.mock("next-auth", () => ({
  default: (config: (typeof mocked.configs)[number]) => {
    mocked.configs.push(config);
    return {
      handlers: {},
      signIn: () => undefined,
      signOut: () => undefined,
      auth: (handler: (req: unknown) => Response) => (req: NextRequest) =>
        handler(Object.assign(req, { auth: mocked.auth })),
    };
  },
}));
const { default: proxy } = await import("@/proxy");
await import("@/server/auth");

// The server instance is the one whose callbacks carry `signIn` (the proxy's does not).
const jwt = mocked.configs.find((c) => c.callbacks?.signIn)!.callbacks!.jwt as (
  a: unknown,
) => Promise<Record<string, unknown> | null>;
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
    mocked.auth = sessionOf((await signIn(id))!);
    const res = visit("/trips/abc?tab=days");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe(
      "/signin/verify?callbackUrl=%2Ftrips%2Fabc%3Ftab%3Ddays",
    );
  });

  it("sends it from /admin, /oauth/authorize and the live library as well", async () => {
    const id = await account(true);
    mocked.auth = sessionOf((await signIn(id))!);
    for (const path of ["/admin", "/oauth/authorize?client_id=x", "/playbooks/rome"]) {
      const res = visit(path);
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname, path).toBe("/signin/verify");
    }
  });

  it("lets the same account in once a server-minted proof has added a second factor", async () => {
    const id = await account(true);
    const token = (await signIn(id))!;
    const { epoch } = await mfaStateFor(id);
    const upgraded = await jwt({
      token,
      trigger: "update",
      session: mintSecondFactorProof(id, token.sid as string, "webauthn", epoch, new Date()),
    });
    expect(upgraded).toMatchObject({ amr: ["google", "webauthn"] });
    mocked.auth = sessionOf(upgraded!);
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
    mocked.auth = sessionOf(forged!);
    expect(visit("/home").status).toBe(307);
  });

  it("refuses a proof from before the epoch moved, and one that has expired", async () => {
    const id = await account(true);
    const token = (await signIn(id))!;
    const { epoch } = await mfaStateFor(id);
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
    const expired = mintSecondFactorProof(id, token.sid as string, "otp", epoch, minutesAgo(3));
    expect(await jwt({ token, trigger: "update", session: expired })).toMatchObject({ amr: ["google"] });
    const stale = mintSecondFactorProof(id, token.sid as string, "otp", epoch, new Date());
    await bumpSecurityEpoch(id);
    expect(await jwt({ token, trigger: "update", session: stale })).toBeNull();
  });

  it("leaves an account without MFA alone", async () => {
    const id = await account(false);
    mocked.auth = sessionOf((await signIn(id))!);
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
      session: mintSecondFactorProof(id, changing.sid as string, "otp", epoch, new Date()),
    });
    expect(renewed).toMatchObject({ epoch, amr: ["google", "otp"] });
    expect(await jwt({ token: renewed! })).not.toBeNull();
  });

  it("keeps a token minted before sessions had an id through the bump it caused itself", async () => {
    const id = await account(true);
    const old = (await signIn(id))!;
    delete old.sid;
    const epoch = await bumpSecurityEpoch(id);
    const sid = (sessionOf(old) as { sid?: string }).sid;
    const renewed = await jwt({
      token: old,
      trigger: "update",
      session: mintSecondFactorProof(id, sid as string, "otp", epoch, new Date()),
    });
    expect(renewed).toMatchObject({ epoch, amr: ["google", "otp"] });
  });

  it("does not let a proof minted for one session upgrade another of the same account", async () => {
    const id = await account(true);
    const [mine, theirs] = [(await signIn(id))!, (await signIn(id))!];
    const { epoch } = await mfaStateFor(id);
    const proof = mintSecondFactorProof(id, mine.sid as string, "otp", epoch, new Date());
    expect(await jwt({ token: theirs, trigger: "update", session: proof })).toMatchObject({ amr: ["google"] });
    expect(await jwt({ token: mine, trigger: "update", session: proof })).toMatchObject({ amr: ["google", "otp"] });
  });

  it("accepts a proof once: replaying it does not renew the fresh-check time", async () => {
    const id = await account(true);
    const token = (await signIn(id))!;
    const { epoch } = await mfaStateFor(id);
    const proof = mintSecondFactorProof(id, token.sid as string, "otp", epoch, new Date());
    const first = (await jwt({ token, trigger: "update", session: proof }))!;
    const mfaAt = first.mfaAt as number;
    await new Promise((r) => setTimeout(r, 5));
    const replayed = (await jwt({ token: first, trigger: "update", session: proof }))!;
    expect(replayed.mfaAt).toBe(mfaAt);
  });
});
