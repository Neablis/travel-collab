import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { userFactors, userRecoveryCodes, users } from "@/server/db/schema";
import { passkeysOf, recordPasskeyUse } from "@/server/mfa/factors";
import { mfaStateFor } from "@/server/mfa/state";
import { softAuthenticator, type SoftAuthenticator } from "@/server/test-support/softAuthenticator";

// Only the Auth.js wrapper is replaced, so the real `@/server/auth` runs: its
// refusal of a half-signed-in session is one of the things under test. What the
// session says is whatever the test sets.
const current = vi.hoisted(() => ({
  session: null as unknown,
  configs: [] as { callbacks?: { jwt?: unknown; signIn?: unknown } }[],
  cookieNames: [] as string[],
  path: null as string | null,
  // Set by a test that wants the work after the factor insert to fail.
  codesFail: false,
}));
vi.mock("next-auth", () => ({
  default: (config: (typeof current.configs)[number]) => {
    current.configs.push(config);
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: async () => current.session };
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => current.cookieNames.map((name) => ({ name })) }),
  headers: async () => ({ get: () => current.path }),
}));
vi.mock("@/server/mfa/recoveryCodes", async (original) => {
  const real = await original<typeof import("@/server/mfa/recoveryCodes")>();
  return {
    ...real,
    issueRecoveryCodes: (...args: Parameters<typeof real.issueRecoveryCodes>) =>
      current.codesFail ? Promise.reject(new Error("the database went away")) : real.issueRecoveryCodes(...args),
  };
});

const { GET: FACTORS } = await import("./factors/route");
const { PATCH: RENAME } = await import("./factors/[factorId]/route");
const { POST: ADD } = await import("./passkeys/route");
const { POST: VERIFY } = await import("../../mfa/verify/route");
const { GET: PREFERENCES } = await import("../preferences/route");
const { GET: SESSION_EXPIRED } = await import("../../session-expired/route");
const { servedForApp } = await import("@/server/servedSession");

const ORIGIN = "https://caesura.example";
const ctx = { origin: ORIGIN, rpId: "caesura.example" };
beforeEach(() => vi.stubEnv("PUBLIC_ORIGIN", ORIGIN));
afterEach(() => vi.unstubAllEnvs());

async function account(): Promise<string> {
  const id = `dev-${randomUUID()}`;
  const now = new Date().toISOString();
  await db.insert(users).values({ id, createdAt: now, updatedAt: now });
  return id;
}

interface SessionClaims {
  mfaPending?: boolean;
  mfaAt?: number;
  signedInAt?: number;
  sid?: string;
}
function signedInAs(id: string, claims: SessionClaims = { signedInAt: Date.now() }) {
  current.session = { user: { id, email: `${id}@example.test` }, sid: "a-session", ...claims };
}

const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
// The union of what these routes answer with; a test reads only the fields its route sets.
interface Body {
  options: { challenge: string; allowCredentials: unknown[] };
  ticket: string;
  proof: unknown;
  recoveryCodes: string[] | null;
  enabled: boolean;
  factors: { id: string; name: string }[];
  error?: string;
}
const json = async (res: Response) => (await res.json()) as Body;

/** Registers `device` through the routes, as a freshly signed-in account would. */
async function addPasskey(device: SoftAuthenticator) {
  const { options, ticket } = await json(await ADD(post({ step: "options" })));
  return ADD(post({ step: "verify", ticket, response: device.attest(options as { challenge: string }, ctx) }));
}

/** The `jwt` callback `server/auth.ts` really wires (the one whose config carries `signIn`), over the real tables. */
const jwt = current.configs.find((c) => c.callbacks?.signIn)!.callbacks!.jwt as (
  a: unknown,
) => Promise<Record<string, unknown> | null>;
const signIn = (id: string) => jwt({ token: {}, user: { id }, account: { providerAccountId: id } });

/** An account with MFA on and one passkey, its session satisfied. */
async function accountWithPasskey() {
  const id = await account();
  const device = softAuthenticator();
  signedInAs(id);
  expect((await addPasskey(device)).status).toBe(200);
  return { id, device };
}

describe("a session that has passed only Google", () => {
  it("is refused by an ordinary API route, and an ordinary session is not", async () => {
    const id = await account();
    signedInAs(id, { mfaPending: true });
    const refused = await PREFERENCES();
    expect(refused.status).toBe(401);

    signedInAs(id, { mfaPending: false });
    expect((await PREFERENCES()).status).toBe(200);
  });

  it("can still reach the verify endpoint, which is how it stops being half signed in", async () => {
    const { id } = await accountWithPasskey();
    signedInAs(id, { mfaPending: true });
    const res = await VERIFY(post({ kind: "passkey", step: "options" }));
    expect(res.status).toBe(200);
    expect((await json(res)).options.allowCredentials).toHaveLength(1);
  });
});

describe("verifying a passkey", () => {
  it("answers with a proof the token callback turns into a second factor", async () => {
    const { id, device } = await accountWithPasskey();
    const signedIn = (await signIn(id))!;
    expect(signedIn.amr).toEqual(["google"]);
    signedInAs(id, { mfaPending: true, sid: signedIn.sid as string });
    const { options, ticket } = await json(await VERIFY(post({ kind: "passkey", step: "options" })));
    const res = await VERIFY(
      post({ kind: "passkey", step: "verify", ticket, response: device.assert(options as { challenge: string }, ctx) }),
    );
    expect(res.status).toBe(200);
    const { proof } = await json(res);

    const updated = await jwt({ token: { ...signedIn }, trigger: "update", session: proof });
    expect(updated!.amr).toEqual(["google", "webauthn"]);
  });

  it("does not set the second factor for an assertion signed by another key", async () => {
    const { id, device } = await accountWithPasskey();
    signedInAs(id, { mfaPending: true });
    const thief = softAuthenticator({ key: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey });
    const { options, ticket } = await json(await VERIFY(post({ kind: "passkey", step: "options" })));
    const forged = device.assert(options as { challenge: string }, ctx) as { response: { signature: string } };
    forged.response.signature = (thief.assert(options as { challenge: string }, ctx) as typeof forged).response.signature;

    const res = await VERIFY(post({ kind: "passkey", step: "verify", ticket, response: forged }));
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "passkey-not-verified" });

    // And what the browser could send NextAuth in its place is not believed either.
    const signedIn = await signIn(id);
    const invented = { method: "webauthn", epoch: 0, expiresAt: Date.now() + 60_000, proof: "0".repeat(64) };
    const updated = await jwt({ token: { ...signedIn }, trigger: "update", session: invented });
    expect(updated!.amr).toEqual(["google"]);
  });

  it("does not set the second factor for another account's passkey", async () => {
    const mine = await accountWithPasskey();
    const theirs = await accountWithPasskey();
    signedInAs(mine.id, { mfaPending: true });
    const { options, ticket } = await json(await VERIFY(post({ kind: "passkey", step: "options" })));
    const res = await VERIFY(
      post({ kind: "passkey", step: "verify", ticket, response: theirs.device.assert(options as { challenge: string }, ctx) }),
    );
    expect(res.status).toBe(401);
  });

  it("does not set the second factor from a challenge issued to a different account", async () => {
    const mine = await accountWithPasskey();
    const other = await accountWithPasskey();
    signedInAs(other.id, { mfaPending: true });
    const { ticket } = await json(await VERIFY(post({ kind: "passkey", step: "options" })));
    signedInAs(mine.id, { mfaPending: true });
    const { options } = await json(await VERIFY(post({ kind: "passkey", step: "options" })));
    const res = await VERIFY(
      post({ kind: "passkey", step: "verify", ticket, response: mine.device.assert(options as { challenge: string }, ctx) }),
    );
    expect(res.status).toBe(401);
  });

  // Synced platform passkeys sign with a counter of 0 forever, so the library's
  // sign-count check never fires for them: the challenge's own single use is what
  // refuses a captured assertion.
  describe("an authenticator whose sign count stays at zero", () => {
    async function asked(sid: string) {
      const id = await account();
      const device = softAuthenticator({ counterStaysZero: true });
      signedInAs(id);
      expect((await addPasskey(device)).status).toBe(200);
      signedInAs(id, { mfaPending: true, sid });
      const { options, ticket } = await json(await VERIFY(post({ kind: "passkey", step: "options" })));
      const response = device.assert(options as { challenge: string }, ctx);
      return { id, ticket, response, verify: () => VERIFY(post({ kind: "passkey", step: "verify", ticket, response })) };
    }

    it("refuses the same assertion and ticket a second time", async () => {
      const { verify } = await asked("s1");
      expect((await verify()).status).toBe(200);
      const replay = await verify();
      expect(replay.status).toBe(401);
      expect(await json(replay)).toEqual({ error: "passkey-not-verified" });
    });

    it("refuses a captured pair presented by a different session", async () => {
      const { id, verify } = await asked("s1");
      signedInAs(id, { mfaPending: true, sid: "s2" });
      expect((await verify()).status).toBe(401);
    });
  });

  it("refuses an account that has no second factor turned on", async () => {
    signedInAs(await account());
    expect((await VERIFY(post({ kind: "passkey", step: "options" }))).status).toBe(409);
  });
});

describe("adding a passkey", () => {
  it("needs a fresh Google sign-in while two-step sign-in is off", async () => {
    signedInAs(await account(), { signedInAt: Date.now() - 11 * 60 * 1000 });
    const res = await ADD(post({ step: "options" }));
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "fresh-check-required" });
  });

  it("turns two-step sign-in on and returns ten recovery codes, once, with the first passkey", async () => {
    const id = await account();
    signedInAs(id);
    const res = await addPasskey(softAuthenticator());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.recoveryCodes).toHaveLength(10);
    expect((await mfaStateFor(id)).enabled).toBe(true);
    // Stored as digests, never as the codes themselves.
    const stored = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, id));
    expect(stored).toHaveLength(10);
    expect(stored.map((r) => r.codeHash)).not.toContain(body.recoveryCodes![0]);
  });

  it("needs a second-factor check, not Google, once it is on, and returns no codes for a second one", async () => {
    const { id } = await accountWithPasskey();
    // Google signed in a minute ago; no second factor has passed.
    signedInAs(id, { signedInAt: Date.now() });
    expect((await ADD(post({ step: "options" }))).status).toBe(403);

    signedInAs(id, { mfaAt: Date.now() });
    const res = await addPasskey(softAuthenticator());
    expect(res.status).toBe(200);
    expect((await json(res)).recoveryCodes).toBeNull();
    expect((await json(await FACTORS())).factors).toHaveLength(2);
  });

  it("turns two-step sign-in on by bumping the epoch, so a session minted before it is refused", async () => {
    const id = await account();
    const adding = (await signIn(id))!;
    const other = (await signIn(id))!;
    signedInAs(id, { signedInAt: Date.now(), sid: adding.sid as string });
    const before = (await mfaStateFor(id)).epoch;

    const res = await addPasskey(softAuthenticator());
    expect(res.status).toBe(200);
    expect((await mfaStateFor(id)).epoch).toBe(before + 1);
    // Another open session never learned the account asks for a second factor.
    expect(await jwt({ token: other })).toBeNull();
    // The one that added it carries on, by the proof the route handed it.
    const kept = await jwt({ token: adding, trigger: "update", session: (await json(res)).proof });
    expect(kept).toMatchObject({ amr: ["google", "webauthn"], epoch: before + 1 });
  });

  it("does not bump the epoch for a second passkey", async () => {
    const { id } = await accountWithPasskey();
    const epoch = (await mfaStateFor(id)).epoch;
    signedInAs(id, { mfaAt: Date.now() });
    expect((await addPasskey(softAuthenticator())).status).toBe(200);
    expect((await mfaStateFor(id)).epoch).toBe(epoch);
  });

  it("refuses an attestation that was not made for this deployment", async () => {
    const id = await account();
    signedInAs(id);
    const { options, ticket } = await json(await ADD(post({ step: "options" })));
    const response = softAuthenticator().attest(options as { challenge: string }, { origin: "https://evil.example", rpId: "caesura.example" });
    const res = await ADD(post({ step: "verify", ticket, response }));
    expect(res.status).toBe(400);
    expect((await mfaStateFor(id)).enabled).toBe(false);
  });
});

describe("turning two-step sign-in on, when something fails halfway", () => {
  afterEach(() => {
    current.codesFail = false;
  });

  it("rolls the whole thing back: no orphan factor, MFA still off, and the error is not read as already-registered", async () => {
    const id = await account();
    signedInAs(id);
    const before = (await mfaStateFor(id)).epoch;
    current.codesFail = true;
    // Not a 409 "already registered": that is for the unique index alone.
    await expect(addPasskey(softAuthenticator())).rejects.toThrow("the database went away");

    expect(await db.select().from(userFactors).where(eq(userFactors.userId, id))).toHaveLength(0);
    expect(await mfaStateFor(id)).toEqual({ enabled: false, epoch: before });

    // The same authenticator can be registered once the fault is gone.
    current.codesFail = false;
    const device = softAuthenticator();
    expect((await addPasskey(device)).status).toBe(200);
  });

  it("answers 409 only for a credential another account already holds", async () => {
    const first = await account();
    const device = softAuthenticator();
    signedInAs(first);
    expect((await addPasskey(device)).status).toBe(200);
    signedInAs(await account());
    expect((await addPasskey(device)).status).toBe(409);
  });
});

describe("renaming a factor", () => {
  it("renames your own, and answers 404 for anyone else's", async () => {
    const mine = await accountWithPasskey();
    const theirs = await accountWithPasskey();
    signedInAs(theirs.id);
    const factor = (await json(await FACTORS())).factors[0]!;

    signedInAs(mine.id);
    const rename = (id: string, name: unknown) =>
      RENAME(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ name }) }), {
        params: Promise.resolve({ factorId: id }),
      });
    expect((await rename(factor.id, "Stolen")).status).toBe(404);

    const own = (await json(await FACTORS())).factors[0]!;
    expect((await rename(own.id, "  iPhone passkey ")).status).toBe(200);
    expect((await json(await FACTORS())).factors[0]!.name).toBe("iPhone passkey");
    expect((await rename(own.id, "   ")).status).toBe(400);
    expect((await rename("not-a-uuid", "x")).status).toBe(404);
  });

  it("lists names and times and never a key", async () => {
    const { id } = await accountWithPasskey();
    signedInAs(id);
    const listed = await json(await FACTORS());
    expect(listed.enabled).toBe(true);
    expect(Object.keys(listed.factors[0]!).sort()).toEqual(["createdAt", "id", "kind", "lastUsedAt", "name"]);
  });
});

describe("storing a passkey's sign count", () => {
  it("never lets a lower count overwrite a higher one", async () => {
    const { id } = await accountWithPasskey();
    const [factor] = await passkeysOf(id);
    const now = new Date();
    const issuedAt = now.getTime() - 1000;
    expect(await recordPasskeyUse(factor!.id, 9, issuedAt, now)).toBe(true);
    // Two assertions racing: the one that read the older count finishes last.
    expect(await recordPasskeyUse(factor!.id, 6, now.getTime() + 1, new Date(now.getTime() + 2))).toBe(false);
    expect((await passkeysOf(id))[0]!.counter).toBe(9);
  });
});

describe("an app route given a session cookie that auth() refuses", () => {
  const sentTo = async () => {
    try {
      await servedForApp();
    } catch (error) {
      return (error as { digest?: string }).digest ?? String(error);
    }
    return null;
  };

  it("sends it through the route that sheds the cookie, carrying the page it asked for", async () => {
    current.cookieNames = ["authjs.session-token"];
    current.session = null;
    current.path = "/trips/t1?tab=days";
    expect(await sentTo()).toContain("/api/session-expired?callbackUrl=%2Ftrips%2Ft1%3Ftab%3Ddays");
  });

  it("serves a signed-in session, and a visitor with no cookie, as before", async () => {
    current.cookieNames = ["authjs.session-token"];
    signedInAs(await account());
    expect(await sentTo()).toBeNull();
    current.cookieNames = [];
    current.session = null;
    expect(await sentTo()).toBeNull();
  });
});

describe("the route a refused cookie is sent through", () => {
  const stale = (callbackUrl = "/trips/t1") =>
    new Request(`http://localhost/api/session-expired?callbackUrl=${encodeURIComponent(callbackUrl)}`, {
      headers: { cookie: "authjs.session-token.0=a; authjs.session-token.1=b; __Secure-authjs.session-token=c; tc_signed_in=1; other=1" },
    });
  const cleared = (res: Response) =>
    res.headers.getSetCookie().filter((line) => /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(line)).map((line) => line.split("=")[0]);

  it("clears every session cookie and the signed-in hint, then goes to sign-in with callbackUrl", async () => {
    current.session = null;
    const res = await SESSION_EXPIRED(stale());
    expect(res.headers.get("location")).toBe("/signin?callbackUrl=%2Ftrips%2Ft1");
    expect(cleared(res).sort()).toEqual(
      ["__Secure-authjs.session-token", "authjs.session-token.0", "authjs.session-token.1", "tc_signed_in"].sort(),
    );
    expect(res.headers.getSetCookie().find((l) => l.startsWith("__Secure-"))).toMatch(/Secure/);
  });

  it("does not take a cookie from a session that is in fact live", async () => {
    signedInAs(await account());
    const res = await SESSION_EXPIRED(stale());
    expect(cleared(res)).toEqual([]);
    expect(res.headers.get("location")).toBe("/trips/t1");
  });

  it("will not send anyone off the site", async () => {
    current.session = null;
    const res = await SESSION_EXPIRED(stale("//evil.example"));
    expect(res.headers.get("location")).toBe("/signin");
  });
});
