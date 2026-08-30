import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdmissionRefusal } from "@tc/contracts";
import { createInvite, revokeInvite } from "./access/invites";
import { checkAdmission, redeemAdmission } from "./admission";
import { executeTripCommand } from "./commands";
import { db } from "./db/client";
import { inviteCodes } from "./db/schema";

// No truncation: every test mints its own identities and its own codes, the
// isolation strategy every sibling suite here uses (KI-69, and the note at the
// top of access/invites.int.test.ts). This suite writes to `invite_codes` and
// `trip_invites`, both of which local development also uses.
let OWNER = "";
let NEWCOMER = "";
let RIVAL = "";

beforeEach(() => {
  const run = randomUUID().slice(0, 8);
  OWNER = `dev-alice-${run}`;
  NEWCOMER = `dev-bob-${run}`;
  RIVAL = `dev-cara-${run}`;
});

// The super code is read from the environment at call time, so a test can turn
// link 3 on and off. Restored after every test — a leaked value would make the
// "unset admits nobody" test pass for the wrong reason.
const SUPER_CODE_VAR = "INVITE_SUPER_CODE";
let superCodeBefore: string | undefined;

beforeEach(() => {
  superCodeBefore = process.env[SUPER_CODE_VAR];
  delete process.env[SUPER_CODE_VAR];
});

afterEach(() => {
  if (superCodeBefore === undefined) delete process.env[SUPER_CODE_VAR];
  else process.env[SUPER_CODE_VAR] = superCodeBefore;
});

async function mintCode(): Promise<string> {
  const code = `code-${randomUUID()}`;
  await db.insert(inviteCodes).values({ code, createdBy: OWNER, createdAt: new Date() });
  return code;
}

async function readCode(code: string) {
  const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
  return row ?? null;
}

async function seedTripInviteToken(): Promise<{ tripId: string; inviteId: string; token: string }> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER);
  expect(created.ok).toBe(true);
  const invite = await createInvite(tripId, OWNER, { email: null, role: "editor" });
  return { tripId, inviteId: invite.inviteId, token: invite.token };
}

describe("redeemAdmission — nothing presented", () => {
  it("refuses with MISSING for null, undefined and whitespace", async () => {
    for (const nothing of [null, undefined, "", "   "]) {
      await expect(redeemAdmission(nothing, NEWCOMER)).resolves.toEqual({
        admitted: false,
        reason: AdmissionRefusal.enum.MISSING_INVITE_CODE,
      });
    }
  });
});

describe("redeemAdmission — link 2, a pending trip invite", () => {
  it("admits the holder of a pending token", async () => {
    const { token } = await seedTripInviteToken();

    await expect(redeemAdmission(token, NEWCOMER)).resolves.toEqual({
      admitted: true,
      via: "trip-invite",
    });
  });

  // The token must survive admission: the person is admitted so they can then
  // land on /invite/<token> and accept it for real. Burning it here would sign
  // them in and then tell them their link was already used — the exact M11
  // regression the milestone says the gate most threatens.
  it("leaves the token pending, so the invite can still be accepted afterwards", async () => {
    const { token } = await seedTripInviteToken();

    await redeemAdmission(token, NEWCOMER);

    await expect(checkAdmission(token)).resolves.toEqual({ admitted: true, via: "trip-invite" });
  });

  // `status = 'pending'` alone already implies unrevoked, because revocation
  // writes `status = 'revoked'` (access/invites.ts:290's precedent). This is
  // the test that keeps that reasoning honest.
  it("refuses a revoked token, which is no longer pending", async () => {
    const { tripId, inviteId, token } = await seedTripInviteToken();
    const revoked = await revokeInvite(tripId, inviteId);
    expect(revoked.ok).toBe(true);

    await expect(redeemAdmission(token, NEWCOMER)).resolves.toEqual({
      admitted: false,
      reason: AdmissionRefusal.enum.INVALID_INVITE_CODE,
    });
  });

  it("refuses a token that was never issued", async () => {
    await expect(redeemAdmission(`not-a-token-${randomUUID()}`, NEWCOMER)).resolves.toEqual({
      admitted: false,
      reason: AdmissionRefusal.enum.INVALID_INVITE_CODE,
    });
  });
});

describe("redeemAdmission — link 3, the reusable super code", () => {
  it("admits, repeatedly, and consumes nothing", async () => {
    process.env[SUPER_CODE_VAR] = `super-${randomUUID()}`;

    await expect(redeemAdmission(process.env[SUPER_CODE_VAR], NEWCOMER)).resolves.toEqual({
      admitted: true,
      via: "super-code",
    });
    await expect(redeemAdmission(process.env[SUPER_CODE_VAR], RIVAL)).resolves.toEqual({
      admitted: true,
      via: "super-code",
    });
  });

  // Absent means CLOSED. The failure this guards is silent in the other
  // direction: a deployment that forgot the variable admitting the internet.
  it("admits nobody when the variable is unset — not even the empty string", async () => {
    expect(process.env[SUPER_CODE_VAR]).toBeUndefined();

    for (const attempt of ["", " ", "undefined", "null", "super-anything"]) {
      const outcome = await redeemAdmission(attempt, NEWCOMER);
      expect(outcome.admitted).toBe(false);
    }
  });

  it("admits nobody when the variable is set to blank", async () => {
    process.env[SUPER_CODE_VAR] = "   ";

    for (const attempt of ["", " ", "   ", "anything"]) {
      const outcome = await redeemAdmission(attempt, NEWCOMER);
      expect(outcome.admitted).toBe(false);
    }
  });
});

describe("redeemAdmission — link 4, a single-use code", () => {
  it("admits once and records who came in on it", async () => {
    const code = await mintCode();

    await expect(redeemAdmission(code, NEWCOMER)).resolves.toEqual({
      admitted: true,
      via: "invite-code",
    });

    const row = await readCode(code);
    expect(row?.redeemedBy).toBe(NEWCOMER);
    expect(row?.redeemedAt).toBeInstanceOf(Date);
  });

  it("refuses the second person with SPENT, not INVALID — a different screen", async () => {
    const code = await mintCode();
    await redeemAdmission(code, NEWCOMER);

    await expect(redeemAdmission(code, RIVAL)).resolves.toEqual({
      admitted: false,
      reason: AdmissionRefusal.enum.SPENT_INVITE_CODE,
    });
    expect((await readCode(code))?.redeemedBy).toBe(NEWCOMER);
  });

  // Two tabs, or a retried OAuth callback. Still one redeemer on the row, so
  // single-use is untouched; `acceptInvite` makes the same judgement for
  // "already used by you".
  it("is idempotent for the person who already spent it", async () => {
    const code = await mintCode();
    await redeemAdmission(code, NEWCOMER);

    await expect(redeemAdmission(code, NEWCOMER)).resolves.toEqual({
      admitted: true,
      via: "invite-code",
    });
    expect((await readCode(code))?.redeemedBy).toBe(NEWCOMER);
  });

  it("refuses a code that never existed with INVALID", async () => {
    await expect(redeemAdmission(`code-${randomUUID()}`, NEWCOMER)).resolves.toEqual({
      admitted: false,
      reason: AdmissionRefusal.enum.INVALID_INVITE_CODE,
    });
  });

  it("tolerates the whitespace a copy-paste drags along", async () => {
    const code = await mintCode();

    await expect(redeemAdmission(`  ${code}\n`, NEWCOMER)).resolves.toEqual({
      admitted: true,
      via: "invite-code",
    });
  });
});

// The exit-gate box, proven against the ROW and not the UI. `redeemAdmission`
// takes no transaction and no lock: the conditional UPDATE is what decides the
// race, exactly as `acceptInvite` does it, and this is the test that says so.
describe("a single-use code under real concurrency", () => {
  it("admits exactly one of two simultaneous redemptions", async () => {
    const code = await mintCode();

    const [first, second] = await Promise.all([
      redeemAdmission(code, NEWCOMER),
      redeemAdmission(code, RIVAL),
    ]);

    const admitted = [first, second].filter((o) => o.admitted);
    const refused = [first, second].filter((o) => !o.admitted);
    expect(admitted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toEqual({
      admitted: false,
      reason: AdmissionRefusal.enum.SPENT_INVITE_CODE,
    });

    // The row is the real assertion: one redeemer, and it is the one that won.
    const row = await readCode(code);
    expect([NEWCOMER, RIVAL]).toContain(row?.redeemedBy);
    expect(row?.redeemedAt).toBeInstanceOf(Date);
  });

  it("admits exactly one of eight simultaneous redemptions", async () => {
    const code = await mintCode();
    const contenders = Array.from({ length: 8 }, (_, i) => `dev-racer-${i}-${randomUUID()}`);

    const outcomes = await Promise.all(contenders.map((who) => redeemAdmission(code, who)));

    expect(outcomes.filter((o) => o.admitted)).toHaveLength(1);
    for (const refused of outcomes.filter((o) => !o.admitted)) {
      expect(refused).toEqual({
        admitted: false,
        reason: AdmissionRefusal.enum.SPENT_INVITE_CODE,
      });
    }
    const row = await readCode(code);
    expect(contenders).toContain(row?.redeemedBy);
  });
});

// Asked by the /signup form so a wrong code is caught before the browser
// leaves for Google. It answers the same question and MUST NOT spend anything.
describe("checkAdmission is advisory", () => {
  it("says a fresh code would admit, without redeeming it", async () => {
    const code = await mintCode();

    await expect(checkAdmission(code)).resolves.toEqual({ admitted: true, via: "invite-code" });

    expect((await readCode(code))?.redeemedBy).toBeNull();
    // …and it is still there to be spent for real afterwards.
    await expect(redeemAdmission(code, NEWCOMER)).resolves.toEqual({
      admitted: true,
      via: "invite-code",
    });
  });

  it("gives the same three refusals the authoritative call gives", async () => {
    const spent = await mintCode();
    await redeemAdmission(spent, NEWCOMER);

    await expect(checkAdmission(null)).resolves.toEqual({
      admitted: false,
      reason: AdmissionRefusal.enum.MISSING_INVITE_CODE,
    });
    await expect(checkAdmission(`code-${randomUUID()}`)).resolves.toEqual({
      admitted: false,
      reason: AdmissionRefusal.enum.INVALID_INVITE_CODE,
    });
    await expect(checkAdmission(spent)).resolves.toEqual({
      admitted: false,
      reason: AdmissionRefusal.enum.SPENT_INVITE_CODE,
    });
  });

  it("admits nobody on the super code when the variable is unset", async () => {
    expect(process.env[SUPER_CODE_VAR]).toBeUndefined();

    const outcome = await checkAdmission("super-anything");
    expect(outcome.admitted).toBe(false);
  });
});
