import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import { db } from "@/server/db/client";
import { apiTokens, oauthGrants, userFactors, userRecoveryCodes, users } from "@/server/db/schema";
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
const { PATCH: RENAME, DELETE: REMOVE } = await import("./factors/[factorId]/route");
const { DELETE: TURN_OFF, POST: REVOKE_ALL } = await import("./route");
const { POST: ADD } = await import("./passkeys/route");
const { POST: ADD_TOTP } = await import("./totp/route");
const { POST: REGENERATE } = await import("./recovery-codes/route");
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

/** The request a change to the account's sign-in arrives as; the routes read its headers for the email. */
const change = () => new Request("http://localhost/x", { method: "DELETE" });
const remove = (factorId: string) => REMOVE(change(), { params: Promise.resolve({ factorId }) });

const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
// The union of what these routes answer with; a test reads only the fields its route sets.
interface Body {
  options: { challenge: string; allowCredentials: unknown[] };
  ticket: string;
  proof: unknown;
  recoveryCodes: string[] | null;
  enabled: boolean;
  recoveryCodesLeft: number;
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

// The PWA lock (M62 D3b) asks for a passkey over a session that has already
// passed. Clearing it must leave that session exactly as it was: no proof, so
// nothing the browser could hand the token callback to move `mfaAt` and restart
// the fresh-check clock (D7) for a tap on a lock screen.
describe("unlocking the installed app with a passkey", () => {
  async function unlock(device: SoftAuthenticator, response?: unknown) {
    const { options, ticket } = await json(await VERIFY(post({ kind: "passkey", step: "options" })));
    return VERIFY(
      post({
        kind: "passkey",
        step: "verify",
        purpose: "unlock",
        ticket,
        response: response ?? device.assert(options as { challenge: string }, ctx),
      }),
    );
  }

  it("succeeds on an assertion and mints no proof, so the session and its mfaAt stay as they were", async () => {
    const { id, device } = await accountWithPasskey();
    const before = await mfaStateFor(id);
    const res = await unlock(device);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unlocked: true });
    expect(await mfaStateFor(id)).toEqual(before);
  });

  it("refuses another account's passkey", async () => {
    const mine = await accountWithPasskey();
    const theirs = await accountWithPasskey();
    signedInAs(mine.id);
    const res = await unlock(theirs.device);
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "passkey-not-verified" });
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

// ---- M62 part 3: the authenticator app and the recovery codes ---------------

/** What the person's app shows for `secret` at `at`: the test's own copy of RFC 6238. */
const codeAt = (secret: string, at: Date) =>
  new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({
    timestamp: at.getTime(),
  });

/** Enrols an authenticator app through the routes; returns the secret the person scanned. */
async function addAuthenticator() {
  const started = (await (await ADD_TOTP(post({ step: "start" }))).json()) as { ticket: string; secret: string; qr: string };
  const res = await ADD_TOTP(post({ step: "confirm", ticket: started.ticket, code: codeAt(started.secret, new Date()) }));
  return { res, secret: started.secret };
}

/** An account whose only factor is an authenticator app, now a half-signed-in session. */
async function accountWithAuthenticator() {
  const id = await account();
  signedInAs(id);
  const { res, secret } = await addAuthenticator();
  expect(res.status).toBe(200);
  const signedIn = (await signIn(id))!;
  signedInAs(id, { mfaPending: true, sid: signedIn.sid as string });
  return { id, secret, codes: (await json(res)).recoveryCodes! };
}

const verifyCode = (kind: "otp" | "recovery", code: string) => VERIFY(post({ kind, code }));

/** Runs `body` with the clock two time steps on, so the enrolment code's own step is behind it. */
async function later<T>(body: (now: Date) => Promise<T>): Promise<T> {
  const now = new Date(Date.now() + 90_000);
  vi.useFakeTimers({ toFake: ["Date"], now });
  try {
    return await body(now);
  } finally {
    vi.useRealTimers();
  }
}

describe("adding an authenticator app", () => {
  it("turns two-step sign-in on as the first factor, with ten recovery codes and a proof", async () => {
    const id = await account();
    signedInAs(id);
    const { res } = await addAuthenticator();
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.proof).toMatchObject({ method: "otp" });
    expect((await mfaStateFor(id)).enabled).toBe(true);
    expect((await json(await FACTORS())).factors).toMatchObject([{ name: "Authenticator app", kind: "totp" }]);
  });

  it("returns no codes for a second factor beside a passkey, and needs the second-factor check", async () => {
    const { id } = await accountWithPasskey();
    signedInAs(id, { signedInAt: Date.now() });
    expect((await ADD_TOTP(post({ step: "start" }))).status).toBe(403);

    signedInAs(id, { mfaAt: Date.now() });
    const { res } = await addAuthenticator();
    expect(res.status).toBe(200);
    expect((await json(res)).recoveryCodes).toBeNull();
  });

  it("refuses a wrong confirmation code and stores nothing", async () => {
    const id = await account();
    signedInAs(id);
    const started = (await (await ADD_TOTP(post({ step: "start" }))).json()) as { ticket: string };
    const res = await ADD_TOTP(post({ step: "confirm", ticket: started.ticket, code: "000000" }));
    expect(res.status).toBe(400);
    expect((await mfaStateFor(id)).enabled).toBe(false);
  });

  it("counts confirmation codes toward the lock, so the sixth is refused even with the right code", async () => {
    const id = await account();
    signedInAs(id);
    const started = (await (await ADD_TOTP(post({ step: "start" }))).json()) as { ticket: string; secret: string };
    for (let i = 0; i < 5; i++) {
      expect((await ADD_TOTP(post({ step: "confirm", ticket: started.ticket, code: "000000" }))).status).toBe(400);
    }
    const right = codeAt(started.secret, new Date());
    expect((await ADD_TOTP(post({ step: "confirm", ticket: started.ticket, code: right }))).status).toBe(429);
    expect((await mfaStateFor(id)).enabled).toBe(false);
  });

  it("answers 409 to a ticket confirmed twice, and keeps one factor", async () => {
    const id = await account();
    signedInAs(id);
    const started = (await (await ADD_TOTP(post({ step: "start" }))).json()) as { ticket: string; secret: string };
    const confirm = () => ADD_TOTP(post({ step: "confirm", ticket: started.ticket, code: codeAt(started.secret, new Date()) }));
    expect((await confirm()).status).toBe(200);
    // The session has since been told about the proof the first confirm handed back.
    signedInAs(id, { mfaAt: Date.now() });
    expect((await confirm()).status).toBe(409);
    expect(await db.select().from(userFactors).where(eq(userFactors.userId, id))).toHaveLength(1);
  });

  it("is a 503 with no key to seal the secret, at the start and at the confirm", async () => {
    const id = await account();
    signedInAs(id);
    const started = (await (await ADD_TOTP(post({ step: "start" }))).json()) as { ticket: string; secret: string };
    vi.stubEnv("MFA_SECRET_KEY", "");
    expect((await ADD_TOTP(post({ step: "start" }))).status).toBe(503);
    // A missing key is the deployment's fault, not a wrong code: it is not counted either.
    for (let i = 0; i < 6; i++) {
      expect((await ADD_TOTP(post({ step: "confirm", ticket: started.ticket, code: "000000" }))).status).toBe(503);
    }
    vi.unstubAllEnvs();
    vi.stubEnv("PUBLIC_ORIGIN", ORIGIN);
    const res = await ADD_TOTP(post({ step: "confirm", ticket: started.ticket, code: codeAt(started.secret, new Date()) }));
    expect(res.status).toBe(200);
  });

  it("rolls the whole thing back when the codes cannot be issued: no factor, MFA off, the ticket still good", async () => {
    const id = await account();
    signedInAs(id);
    const started = (await (await ADD_TOTP(post({ step: "start" }))).json()) as { ticket: string; secret: string };
    const confirm = () => ADD_TOTP(post({ step: "confirm", ticket: started.ticket, code: codeAt(started.secret, new Date()) }));
    current.codesFail = true;
    try {
      // Not a 409 "already added": that is the primary key alone.
      await expect(confirm()).rejects.toThrow("the database went away");
    } finally {
      current.codesFail = false;
    }
    expect(await db.select().from(userFactors).where(eq(userFactors.userId, id))).toHaveLength(0);
    expect((await mfaStateFor(id)).enabled).toBe(false);
    expect((await confirm()).status).toBe(200);
  });
});

describe("signing in with an authenticator code", () => {
  it("is a 503, not a wrong code, when there is no key to open the secret, and it is not counted", async () => {
    const { secret } = await accountWithAuthenticator();
    await later(async (now) => {
      vi.stubEnv("MFA_SECRET_KEY", "");
      for (let i = 0; i < 6; i++) expect((await verifyCode("otp", codeAt(secret, now))).status).toBe(503);
      vi.unstubAllEnvs();
      vi.stubEnv("PUBLIC_ORIGIN", ORIGIN);
      expect((await verifyCode("otp", codeAt(secret, now))).status).toBe(200);
    });
  });

  it("gives a proof the token callback turns into a second factor, and refuses the same code twice", async () => {
    const { secret } = await accountWithAuthenticator();
    await later(async (now) => {
      const code = codeAt(secret, now);
      const res = await verifyCode("otp", code);
      expect(res.status).toBe(200);
      expect(((await json(res)).proof as { method: string }).method).toBe("otp");
      expect((await verifyCode("otp", code)).status).toBe(401);
    });
  });

  it("counts a wrong code toward the lock, and the sixth try is refused even with the right code", async () => {
    const { secret } = await accountWithAuthenticator();
    await later(async (now) => {
      for (let i = 0; i < 5; i++) expect((await verifyCode("otp", "000000")).status).toBe(401);
      const locked = await verifyCode("otp", codeAt(secret, now));
      expect(locked.status).toBe(429);
      expect(await json(locked)).toEqual({ error: "locked" });
      // Recovery codes are codes too.
      expect((await verifyCode("recovery", "aaaaa-bbbbb")).status).toBe(429);
    });
  });

  it("leaves a passkey working while codes are locked", async () => {
    const { id, device } = await accountWithPasskey();
    const signedIn = (await signIn(id))!;
    signedInAs(id, { mfaPending: true, sid: signedIn.sid as string });
    for (let i = 0; i < 5; i++) await verifyCode("otp", "000000");
    expect((await verifyCode("otp", "000000")).status).toBe(429);
    const { options, ticket } = await json(await VERIFY(post({ kind: "passkey", step: "options" })));
    const res = await VERIFY(
      post({ kind: "passkey", step: "verify", ticket, response: device.assert(options as { challenge: string }, ctx) }),
    );
    expect(res.status).toBe(200);
  });
});

describe("recovery codes", () => {
  it("each works once, whatever the case or dash, and gives a proof", async () => {
    const { codes } = await accountWithAuthenticator();
    const res = await verifyCode("recovery", codes[0]!.toUpperCase());
    expect(res.status).toBe(200);
    expect(((await json(res)).proof as { method: string }).method).toBe("recovery");
    expect((await verifyCode("recovery", codes[0]!)).status).toBe(401);
    expect((await verifyCode("recovery", codes[1]!.replace("-", " "))).status).toBe(200);
  });

  it("reports how many are left", async () => {
    const { id, codes } = await accountWithAuthenticator();
    await verifyCode("recovery", codes[0]!);
    signedInAs(id, { mfaAt: Date.now() });
    expect((await json(await FACTORS())).recoveryCodesLeft).toBe(9);
  });
});

describe("regenerating recovery codes", () => {
  it("hands this session its new epoch without restarting the fresh-check clock", async () => {
    const { id } = await accountWithAuthenticator();
    const mine = (await signIn(id))!;
    const checkedAt = Date.now() - 9 * 60 * 1000;
    mine.mfaAt = checkedAt;
    signedInAs(id, { mfaAt: checkedAt, sid: mine.sid as string });
    const before = (await mfaStateFor(id)).epoch;
    const res = await REGENERATE(change());
    // No factor was presented, so a stolen fresh check cannot be chained into a fresh one.
    expect(await jwt({ token: mine, trigger: "update", session: (await json(res)).proof })).toMatchObject({
      epoch: before + 1,
      mfaAt: checkedAt,
    });
  });

  it("voids the old set and the new codes work", async () => {
    const { id, codes: old } = await accountWithAuthenticator();
    signedInAs(id, { mfaAt: Date.now() });
    const res = await REGENERATE(change());
    expect(res.status).toBe(200);
    const fresh = (await json(res)).recoveryCodes!;
    expect(fresh).toHaveLength(10);

    const signedIn = (await signIn(id))!;
    signedInAs(id, { mfaPending: true, sid: signedIn.sid as string });
    expect((await verifyCode("recovery", old[0]!)).status).toBe(401);
    expect((await verifyCode("recovery", fresh[0]!)).status).toBe(200);
  });

  it("needs the second-factor check, and only while two-step sign-in is on", async () => {
    const { id } = await accountWithAuthenticator();
    signedInAs(id, { signedInAt: Date.now() });
    expect((await REGENERATE(change())).status).toBe(403);

    signedInAs(await account(), { mfaAt: Date.now() });
    expect((await REGENERATE(change())).status).toBe(409);
  });

  it("bumps the epoch, so another session is refused and this one carries on by its proof", async () => {
    const { id } = await accountWithAuthenticator();
    const other = (await signIn(id))!;
    const mine = (await signIn(id))!;
    signedInAs(id, { mfaAt: Date.now(), sid: mine.sid as string });
    const before = (await mfaStateFor(id)).epoch;
    const res = await REGENERATE(change());
    expect((await mfaStateFor(id)).epoch).toBe(before + 1);
    expect(await jwt({ token: other })).toBeNull();
    expect(await jwt({ token: mine, trigger: "update", session: (await json(res)).proof })).toMatchObject({ epoch: before + 1 });
  });
});

/** An account with a passkey and an authenticator app, and two sessions on it: the one acting, and another. */
async function accountWithTwoFactors() {
  const { id, device } = await accountWithPasskey();
  signedInAs(id, { mfaAt: Date.now() });
  expect((await addAuthenticator()).res.status).toBe(200);
  const other = (await signIn(id))!;
  const mine = (await signIn(id))!;
  signedInAs(id, { mfaAt: Date.now(), sid: mine.sid as string });
  const { factors } = await json(await FACTORS());
  return { id, device, other, mine, factors };
}

describe("removing a factor", () => {
  it("refuses the last one, and leaves it, two-step sign-in on and the epoch where they were", async () => {
    const { id } = await accountWithPasskey();
    signedInAs(id, { mfaAt: Date.now() });
    const [only] = (await json(await FACTORS())).factors;
    const before = (await mfaStateFor(id)).epoch;

    const res = await remove(only!.id);
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "last-factor" });
    expect((await json(await FACTORS())).factors).toHaveLength(1);
    expect(await mfaStateFor(id)).toEqual({ enabled: true, epoch: before });
  });

  it("signs out a session minted before it, and this one carries on by its proof", async () => {
    const { id, other, mine, factors } = await accountWithTwoFactors();
    const before = (await mfaStateFor(id)).epoch;

    const res = await remove(factors[0]!.id);
    expect(res.status).toBe(200);
    expect((await json(await FACTORS())).factors).toHaveLength(1);
    expect((await mfaStateFor(id)).epoch).toBe(before + 1);
    expect(await jwt({ token: other })).toBeNull();
    expect(await jwt({ token: mine })).toBeNull();
    expect(await jwt({ token: mine, trigger: "update", session: (await json(res)).proof })).toMatchObject({ epoch: before + 1 });
  });

  it("needs the second-factor check", async () => {
    const { id, factors } = await accountWithTwoFactors();
    signedInAs(id, { signedInAt: Date.now() });
    const res = await remove(factors[0]!.id);
    expect(res.status).toBe(403);
    expect((await json(await FACTORS())).factors).toHaveLength(2);
  });

  it("answers 404 for a factor on another account, and for an id that is not one", async () => {
    const { factors } = await accountWithTwoFactors();
    const { id: stranger } = await accountWithPasskey();
    signedInAs(stranger, { mfaAt: Date.now() });
    expect((await remove(factors[0]!.id)).status).toBe(404);
    expect((await remove("not-a-uuid")).status).toBe(404);
  });
});

describe("turning two-step sign-in off", () => {
  it("removes every factor and code, signs out the other sessions and keeps this one", async () => {
    const { id, other, mine } = await accountWithTwoFactors();
    const before = (await mfaStateFor(id)).epoch;

    const res = await TURN_OFF(change());
    expect(res.status).toBe(200);
    expect(await db.select().from(userFactors).where(eq(userFactors.userId, id))).toHaveLength(0);
    expect(await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, id))).toHaveLength(0);
    expect(await mfaStateFor(id)).toEqual({ enabled: false, epoch: before + 1 });
    expect(await jwt({ token: other })).toBeNull();
    expect(await jwt({ token: mine, trigger: "update", session: (await json(res)).proof })).toMatchObject({
      epoch: before + 1,
      mfaRequired: false,
    });
  });

  it("needs the second-factor check, and only while two-step sign-in is on", async () => {
    const { id } = await accountWithTwoFactors();
    signedInAs(id, { signedInAt: Date.now() });
    expect((await TURN_OFF(change())).status).toBe(403);
    expect((await mfaStateFor(id)).enabled).toBe(true);

    signedInAs(await account(), { mfaAt: Date.now() });
    expect((await TURN_OFF(change())).status).toBe(409);
  });
});

describe("revoking every token and connected app", () => {
  async function credentialsOf(id: string) {
    const created = new Date();
    await db.insert(apiTokens).values({
      id: randomUUID(),
      ownerId: id,
      name: "Calendar sync",
      tokenHash: randomUUID(),
      keyVersion: "v1",
      prefix: "tc_abcde",
      scopes: ["trips:read"],
      tripIds: null,
      createdAt: created,
      expiresAt: new Date(created.getTime() + 86_400_000),
    });
    await db.insert(oauthGrants).values({
      id: randomUUID(),
      ownerId: id,
      clientId: randomUUID(),
      clientName: "An app",
      redirectUri: "https://example.com/cb",
      scopes: ["trips:read"],
      resource: "https://caesura.example/api/mcp",
      createdAt: created,
      expiresAt: new Date(created.getTime() + 86_400_000),
    });
  }
  const live = async (id: string) => ({
    tokens: await db.select().from(apiTokens).where(and(eq(apiTokens.ownerId, id), isNull(apiTokens.revokedAt))),
    grants: await db.select().from(oauthGrants).where(and(eq(oauthGrants.ownerId, id), isNull(oauthGrants.revokedAt))),
  });

  it("revokes this account's and nobody else's", async () => {
    const { id } = await accountWithPasskey();
    const { id: neighbour } = await accountWithPasskey();
    await credentialsOf(id);
    await credentialsOf(neighbour);
    signedInAs(id, { mfaAt: Date.now() });

    const res = await REVOKE_ALL();
    expect(await res.json()).toEqual({ tokens: 1, grants: 1 });
    expect(await live(id)).toEqual({ tokens: [], grants: [] });
    expect((await live(neighbour)).tokens).toHaveLength(1);
    expect((await live(neighbour)).grants).toHaveLength(1);
  });

  it("needs the second-factor check", async () => {
    const { id } = await accountWithPasskey();
    await credentialsOf(id);
    signedInAs(id, { signedInAt: Date.now() });
    expect((await REVOKE_ALL()).status).toBe(403);
    expect((await live(id)).tokens).toHaveLength(1);
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
