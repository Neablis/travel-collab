import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { AdmissionRefusal } from "@tc/contracts";
import type { PendingAdmission } from "./admission";
import { executeTripCommand } from "./commands";
import { db } from "./db/client";
import { inviteCodes, users } from "./db/schema";
import { events } from "./db/schema";
import { readPreferences, recordSignIn, upsertUser, writePreferences } from "./users";
import { getTripDetail } from "./projections";

// No beforeEach truncation: every test mints its own id, same isolation
// strategy as the sibling suites (see eventStore.int.test.ts and
// docs/testing-baseline.md).
const signInId = () => `dev-${randomUUID()}`;

/**
 * The payload Auth.js actually delivers for a sign-in by `subject`.
 *
 * The subject goes on the ACCOUNT, which is the only place a durable id ever
 * comes from (`normalizeIdentity`). Every call here used to pass it as
 * `user.id` instead — modelling the assumption rather than the reality, which
 * is why this suite stayed green through the 2026-09-05 incident.
 */
const signInAs = (
  subject: string | null,
  user: { name?: string; email?: string; image?: string | null } = {},
) => ({ user, account: { providerAccountId: subject } });

async function readUser(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

// M11a: `recordSignIn` reads its admission credential from the
// `pending_admission` cookie, and `next/headers` has no request to read here.
// The seam is a parameter for exactly this reason — the gate is driven for
// real, only the jar is faked, and `cleared` is what the "no credential
// outlives its sign-in" exit-gate box is asserted against.
function fakeJar(value: string | null): PendingAdmission & { cleared: boolean } {
  const jar = {
    cleared: false,
    read: () => Promise.resolve(value),
    clear: () => {
      jar.cleared = true;
      return Promise.resolve();
    },
  };
  return jar;
}

// A shared super code, so the identity tests below stay about identity: they
// need SOME admission and do not care which. Set for this file only and
// restored after it — `admission.int.test.ts` deletes it in its own beforeEach,
// so its "unset admits nobody" test cannot be poisoned by this.
const SUPER_CODE = `super-${randomUUID()}`;
let superCodeBefore: string | undefined;

beforeAll(() => {
  superCodeBefore = process.env.INVITE_SUPER_CODE;
  process.env.INVITE_SUPER_CODE = SUPER_CODE;
});

afterAll(() => {
  if (superCodeBefore === undefined) delete process.env.INVITE_SUPER_CODE;
  else process.env.INVITE_SUPER_CODE = superCodeBefore;
});

/** A jar carrying a credential that admits — for tests not about admission. */
const admitting = () => fakeJar(SUPER_CODE);

async function mintCode(createdBy: string): Promise<string> {
  const code = `code-${randomUUID()}`;
  await db.insert(inviteCodes).values({ code, createdBy, createdAt: new Date() });
  return code;
}

describe("users repository", () => {
  it("creates a durable row for a first-time sign-in", async () => {
    const id = signInId();
    await upsertUser({ id, email: "ana@example.com", name: "Ana", image: "https://img.test/a.png" }, "2026-08-27T10:00:00.000Z");

    expect(await readUser(id)).toEqual({
      id,
      email: "ana@example.com",
      name: "Ana",
      image: "https://img.test/a.png",
      // M17's columns, at their storage defaults. `toEqual` rather than
      // `toMatchObject` on purpose: a new column added without a decision about
      // what a first sign-in should hold fails here.
      displayName: null,
      homeAirport: null,
      distanceUnit: "km",
      createdAt: "2026-08-27 10:00:00+00",
      updatedAt: "2026-08-27 10:00:00+00",
    });
  });

  it("refreshes the profile on a later sign-in without minting a second row or moving createdAt", async () => {
    const id = signInId();
    await upsertUser({ id, email: "ana@example.com", name: "Ana", image: null }, "2026-08-27T10:00:00.000Z");
    await upsertUser({ id, email: "ana@example.com", name: "Ana Lee", image: "https://img.test/new.png" }, "2026-09-01T09:30:00.000Z");

    const row = await readUser(id);
    expect(row).toMatchObject({
      name: "Ana Lee",
      image: "https://img.test/new.png",
      createdAt: "2026-08-27 10:00:00+00",
      updatedAt: "2026-09-01 09:30:00+00",
    });
    expect(await db.select().from(users).where(eq(users.id, id))).toHaveLength(1);
  });

  it("clears a profile field the provider no longer sends (last sign-in wins)", async () => {
    const id = signInId();
    await upsertUser({ id, email: "b@example.com", name: "B", image: "https://img.test/b.png" });
    await upsertUser({ id, email: "b@example.com", name: "B", image: null });

    expect((await readUser(id))?.image).toBeNull();
  });
});

// M17. The preference columns are ordinary CRUD on the same row, read and
// written by nothing but this module.
describe("account preferences (M17)", () => {
  it("answers with the storage defaults for a session with no row", async () => {
    // Not an error, and not a thrown 500 on every authenticated page: sessions
    // are JWT-only (ADR-025), so a token outlives the row it was minted from.
    expect(await readPreferences(signInId())).toEqual({
      displayName: null,
      homeAirport: null,
      distanceUnit: "km",
    });
  });

  it("defaults a real row to kilometres and nothing else set", async () => {
    const id = signInId();
    await upsertUser({ id, email: "p@example.com", name: "P", image: null });

    expect(await readPreferences(id)).toEqual({
      displayName: null,
      homeAirport: null,
      distanceUnit: "km",
    });
  });

  it("writes what it is given and reads it back whole", async () => {
    const id = signInId();
    await upsertUser({ id, email: "p@example.com", name: "P", image: null });

    const written = await writePreferences(id, {
      displayName: "Mitchell",
      homeAirport: "SFO",
      distanceUnit: "mi",
    });

    expect(written).toEqual({ displayName: "Mitchell", homeAirport: "SFO", distanceUnit: "mi" });
    expect(await readPreferences(id)).toEqual(written);
  });

  // Absent means "leave it alone"; explicit null means "clear it". The two are
  // different operations all the way down — a `?? undefined` anywhere on this
  // path would silently turn the second into the first.
  it("leaves an absent field alone and clears an explicit null", async () => {
    const id = signInId();
    await upsertUser({ id, email: "p@example.com", name: "P", image: null });
    await writePreferences(id, { displayName: "Mitchell", homeAirport: "SFO" });

    await writePreferences(id, { distanceUnit: "mi" });
    expect(await readPreferences(id)).toEqual({
      displayName: "Mitchell",
      homeAirport: "SFO",
      distanceUnit: "mi",
    });

    await writePreferences(id, { displayName: null });
    expect(await readPreferences(id)).toEqual({
      displayName: null,
      homeAirport: "SFO",
      distanceUnit: "mi",
    });
  });

  // Not an upsert. `upsertUser` in the sign-in callback is the Identity
  // module's only creator of rows and it sits behind the admission gate (M11a);
  // a settings PATCH must not be a second door into that.
  it("refuses to invent a row for a user who has none", async () => {
    const id = signInId();
    expect(await writePreferences(id, { distanceUnit: "mi" })).toBeNull();
    expect(await readUser(id)).toBeNull();
  });

  it("moves updatedAt, which is what makes this an audited CRUD write", async () => {
    const id = signInId();
    await upsertUser({ id, email: "p@example.com", name: "P", image: null }, "2026-08-27T10:00:00.000Z");
    await writePreferences(id, { distanceUnit: "mi" }, "2026-09-02T08:00:00.000Z");

    expect((await readUser(id))?.updatedAt).toBe("2026-09-02 08:00:00+00");
  });

  // THE reason `display_name` is a column of its own rather than a better-used
  // `users.name`. `upsertUser`'s `onConflictDoUpdate` enumerates its `set` list
  // by hand — `email`, `name`, `image`, `updatedAt` — so the preference columns
  // are simply not in it, and a name someone typed survives the next sign-in
  // with Google. If somebody ever "tidies" that set list into a spread of the
  // whole row, this test is what goes red.
  it("does not let a later sign-in clobber a name the person chose", async () => {
    const id = signInId();
    await upsertUser({ id, email: "ana@example.com", name: "Ana Provider", image: null });
    await writePreferences(id, { displayName: "Ana", homeAirport: "SFO", distanceUnit: "mi" });

    // The real callback, driven for real — not a second `upsertUser` call.
    await expect(recordSignIn(signInAs(id, { name: "Ana Provider", email: "ana@example.com" }), admitting())).resolves.toBe(true);

    expect(await readPreferences(id)).toEqual({
      displayName: "Ana",
      homeAirport: "SFO",
      distanceUnit: "mi",
    });
    // And the provider's own field still refreshes, so this is not passing
    // because the upsert stopped writing anything.
    expect((await readUser(id))?.name).toBe("Ana Provider");
  });
});

describe("recordSignIn (the Auth.js signIn callback)", () => {
  it("admits a sign-in and leaves the user durable behind it", async () => {
    const id = signInId();
    await expect(
      recordSignIn(signInAs(id, { name: "  Alice  ", email: "ALICE@Example.com" }), admitting()),
    ).resolves.toBe(true);

    expect(await readUser(id)).toMatchObject({ id, name: "Alice", email: "alice@example.com" });
  });

  it("is idempotent across repeated sign-ins, which is the normal case", async () => {
    const id = signInId();
    await recordSignIn(signInAs(id, { name: "Alice" }), admitting());
    await recordSignIn(signInAs(id, { name: "Alice" }), admitting());

    expect(await db.select().from(users).where(eq(users.id, id))).toHaveLength(1);
  });

  // THE 2026-09-05 REGRESSION, at the seam where it actually happened.
  //
  // The test above could not catch it, because it hands the same id twice —
  // which is exactly what Auth.js does NOT do. On a real Google sign-in the
  // `user` object carries a fresh `crypto.randomUUID()` every time and only
  // `account.providerAccountId` is stable, so this drives the payload the way
  // production delivers it: a different user each time, one Google account.
  //
  // Both halves matter. One row is the account not being duplicated; `true`
  // from a jar holding NOTHING is the person not being sent back through the
  // M11a invite gate as a stranger — the screen that was actually reported.
  it("treats every sign-in by one Google account as the same person, though Auth.js re-rolls the user", async () => {
    const subject = `google-${randomUUID()}`;
    const email = `${subject}@example.com`;

    await expect(recordSignIn(signInAs(subject, { name: "Mitchell", email }), admitting())).resolves.toBe(true);

    // Second sign-in: same Google account, and no admission credential at all.
    await expect(recordSignIn(signInAs(subject, { name: "Mitchell", email }), fakeJar(null))).resolves.toBe(true);
    // A third, because "a few times now" is the shape of the report.
    await expect(recordSignIn(signInAs(subject, { name: "Mitchell", email }), fakeJar(null))).resolves.toBe(true);

    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(1);
    expect(await readUser(subject)).toMatchObject({ id: subject, email });
  });

  // The other half of what production showed: preferences stranded on a row
  // nobody could sign back into. One account means the settings survive.
  it("keeps a returning Google account's preferences across sign-ins", async () => {
    const subject = `google-${randomUUID()}`;
    await recordSignIn(signInAs(subject, { name: "Mitchell" }), admitting());
    await writePreferences(subject, { displayName: "Mitchell", homeAirport: "OAK", distanceUnit: "mi" });

    await recordSignIn(signInAs(subject, { name: "Mitchell" }), fakeJar(null));

    expect(await readPreferences(subject)).toEqual({
      displayName: "Mitchell",
      homeAirport: "OAK",
      distanceUnit: "mi",
    });
  });

  // Unchanged by M11a and deliberately so: the no-id path is refused with
  // `false`, before the gate is even consulted, and `false` still means the
  // designed /signup?error= screen. Fail-closed was widened, not weakened.
  it("refuses a payload with no usable id rather than creating an anonymous row", async () => {
    await expect(recordSignIn(signInAs("  ", { name: "Nobody" }))).resolves.toBe(false);
    await expect(recordSignIn({ user: null })).resolves.toBe(false);
  });
});

// M11a: the gate itself, at the seam where it actually runs.
describe("recordSignIn is the invite gate (M11a)", () => {
  // The exit-gate box: nobody already here gets locked out, Mitchell included.
  // Admission is "has no users row" (ADR-025), so an existing row is admission
  // — and the read has to happen BEFORE `upsertUser`, which is a bare
  // onConflictDoUpdate with no RETURNING and cannot say whether the row is new.
  it("admits an existing users row with no credential at all", async () => {
    const id = signInId();
    await upsertUser({ id, email: "ana@example.com", name: "Ana", image: null });

    await expect(recordSignIn(signInAs(id, { name: "Ana" }), fakeJar(null))).resolves.toBe(true);
  });

  it("spends no code for someone who was already here", async () => {
    const id = signInId();
    await upsertUser({ id, email: null, name: "Ana", image: null });
    const code = await mintCode(id);

    await expect(recordSignIn(signInAs(id, { name: "Ana" }), fakeJar(code))).resolves.toBe(true);

    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
    expect(row?.redeemedBy).toBeNull();
  });

  // DEV LOGIN IS ITS OWN ADMISSION, and the gate is the environment rather than
  // the id string. `AUTH_DEV_LOGIN=true` + `VERCEL_ENV !== "production"` is what
  // `isDevLoginEnabled()` requires, and the dev-login PROVIDER is only
  // registered when that holds — so a Google sign-in cannot present
  // `provider: "dev-login"` and a production deployment cannot register it at
  // all. Keying on the provider Auth.js actually authenticated with, not on a
  // `dev-` prefix in `providerAccountId`, is the difference between a gate and
  // a guessable string.
  describe("dev login", () => {
    const devSignIn = (subject: string) => ({
      user: { name: subject.replace(/^dev-/, "") },
      account: { providerAccountId: subject, provider: "dev-login" },
    });

    it("admits a brand-new dev user with no invite code, and creates the row", async () => {
      const id = `dev-${signInId()}`;

      await expect(recordSignIn(devSignIn(id), fakeJar(null))).resolves.toBe(true);
      expect(await readUser(id)).not.toBeNull();
    });

    it("spends no invite code doing it", async () => {
      const id = `dev-${signInId()}`;
      const code = await mintCode(id);

      await expect(recordSignIn(devSignIn(id), fakeJar(code))).resolves.toBe(true);

      const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
      expect(row?.redeemedBy).toBeNull();
    });

    it("does NOT admit a dev-shaped id presented by another provider", async () => {
      const id = `dev-${signInId()}`;

      await expect(
        recordSignIn(
          { user: { name: "Impostor" }, account: { providerAccountId: id, provider: "google" } },
          fakeJar(null),
        ),
      ).resolves.toBe(`/signup?error=${AdmissionRefusal.enum.MISSING_INVITE_CODE}`);
      expect(await readUser(id)).toBeNull();
    });

    // The e2e opt-out. Without this the bypass would silently delete
    // `m11a-invite-gate.spec.ts`'s entire subject — it proves the gate THROUGH
    // dev login, because that is the only way a browser test mints a brand-new
    // identity. `playwright.config.ts` sets this; nothing else does.
    it("honours the invite gate when DEV_LOGIN_HONOURS_INVITE_GATE is set", async () => {
      const id = `dev-${signInId()}`;
      const previous = process.env.DEV_LOGIN_HONOURS_INVITE_GATE;
      process.env.DEV_LOGIN_HONOURS_INVITE_GATE = "true";
      try {
        await expect(recordSignIn(devSignIn(id), fakeJar(null))).resolves.toBe(
          `/signup?error=${AdmissionRefusal.enum.MISSING_INVITE_CODE}`,
        );
        expect(await readUser(id)).toBeNull();
      } finally {
        if (previous === undefined) delete process.env.DEV_LOGIN_HONOURS_INVITE_GATE;
        else process.env.DEV_LOGIN_HONOURS_INVITE_GATE = previous;
      }
    });

    it("does NOT admit dev-login when the environment has it switched off", async () => {
      const id = `dev-${signInId()}`;
      const previous = process.env.AUTH_DEV_LOGIN;
      process.env.AUTH_DEV_LOGIN = "false";
      try {
        await expect(recordSignIn(devSignIn(id), fakeJar(null))).resolves.toBe(
          `/signup?error=${AdmissionRefusal.enum.MISSING_INVITE_CODE}`,
        );
        expect(await readUser(id)).toBeNull();
      } finally {
        if (previous === undefined) delete process.env.AUTH_DEV_LOGIN;
        else process.env.AUTH_DEV_LOGIN = previous;
      }
    });
  });

  // The headline refusal: a brand-new account with no admission is refused and
  // LEAVES NO USERS ROW BEHIND.
  it("refuses a newcomer who presents nothing, and creates no row", async () => {
    const id = signInId();

    await expect(recordSignIn(signInAs(id, { name: "Nobody" }), fakeJar(null))).resolves.toBe(
      `/signup?error=${AdmissionRefusal.enum.MISSING_INVITE_CODE}`,
    );
    expect(await readUser(id)).toBeNull();
  });

  it("refuses a newcomer who presents an unrecognised code, and creates no row", async () => {
    const id = signInId();

    await expect(
      recordSignIn(signInAs(id, { name: "Nobody" }), fakeJar(`code-${randomUUID()}`)),
    ).resolves.toBe(`/signup?error=${AdmissionRefusal.enum.INVALID_INVITE_CODE}`);
    expect(await readUser(id)).toBeNull();
  });

  it("refuses a newcomer who presents a spent code, and creates no row", async () => {
    const first = signInId();
    const second = signInId();
    const code = await mintCode(first);
    await recordSignIn(signInAs(first, { name: "First" }), fakeJar(code));

    await expect(recordSignIn(signInAs(second, { name: "Second" }), fakeJar(code))).resolves.toBe(
      `/signup?error=${AdmissionRefusal.enum.SPENT_INVITE_CODE}`,
    );
    expect(await readUser(second)).toBeNull();
    expect(await readUser(first)).not.toBeNull();
  });

  it("admits a newcomer holding a single-use code, and burns it in the same sign-in", async () => {
    const id = signInId();
    const code = await mintCode(id);

    await expect(recordSignIn(signInAs(id, { name: "New" }), fakeJar(code))).resolves.toBe(true);

    expect(await readUser(id)).not.toBeNull();
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
    expect(row?.redeemedBy).toBe(id);
  });

  // The exit-gate box: no admission credential outlives the sign-in that used
  // it. All three outcomes clear it, including the returning user who never
  // needed it.
  it("clears the pending credential on success, on refusal, and for a returning user", async () => {
    const admittedJar = fakeJar(SUPER_CODE);
    await expect(recordSignIn(signInAs(signInId()), admittedJar)).resolves.toBe(true);
    expect(admittedJar.cleared).toBe(true);

    const refusedJar = fakeJar(`code-${randomUUID()}`);
    const refused = await recordSignIn(signInAs(signInId()), refusedJar);
    expect(refused).not.toBe(true);
    expect(refusedJar.cleared).toBe(true);

    const returning = signInId();
    await upsertUser({ id: returning, email: null, name: null, image: null });
    const returningJar = fakeJar(SUPER_CODE);
    await expect(recordSignIn(signInAs(returning), returningJar)).resolves.toBe(true);
    expect(returningJar.cleared).toBe(true);
  });

  // Every refusal is a member of the closed contract enum — never a free
  // string that happens to look like one.
  it("returns only refusals the AdmissionRefusal contract recognises", async () => {
    const spent = await mintCode(signInId());
    await recordSignIn(signInAs(signInId()), fakeJar(spent));

    const refusals = await Promise.all([
      recordSignIn(signInAs(signInId()), fakeJar(null)),
      recordSignIn(signInAs(signInId()), fakeJar(`code-${randomUUID()}`)),
      recordSignIn(signInAs(signInId()), fakeJar(spent)),
    ]);

    for (const refusal of refusals) {
      expect(typeof refusal).toBe("string");
      const code = new URL(refusal as string, "https://x.test").searchParams.get("error");
      expect(AdmissionRefusal.safeParse(code).success).toBe(true);
    }
    expect(new Set(refusals).size).toBe(3);
  });
});

// The wiring claim the schema comment on `events.actor_id` makes, end to end:
// there is no foreign key, so what makes an actor id refer to a user row is
// that sign-in is the only place a session id comes from and it writes the row
// first. This drives that order and checks both ends of it.
describe("actorId refers to a user row (ADR-025)", () => {
  it("every actor id a signed-in session can produce already has a users row behind it", async () => {
    const id = signInId();
    await recordSignIn(signInAs(id, { name: "Ana", email: "ana@example.com" }), admitting());

    const tripId = randomUUID();
    const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, id);
    expect(result.ok).toBe(true);

    const [event] = await db.select().from(events).where(eq(events.streamId, tripId));
    expect(event?.actorId).toBe(id);
    expect(await readUser(event!.actorId)).not.toBeNull();

    // …and the same string is what the trip's member list carries, so a member
    // is resolvable to a person without widening TripMember (link 2's job).
    const detail = await getTripDetail(tripId);
    expect(detail?.members.map((m) => m.userId)).toEqual([id]);
    expect(await readUser(detail!.members[0]!.userId)).not.toBeNull();
  });

  it("does not pretend the reserved 'system' actor is a person", async () => {
    // pages.ts writes actor_id 'system' for lazily seeded default pages. It is
    // deliberately not a users row — this is the reason there is no FK, and it
    // is asserted here so a future FK cannot be added without seeing it fail.
    expect(await readUser("system")).toBeNull();
  });
});
