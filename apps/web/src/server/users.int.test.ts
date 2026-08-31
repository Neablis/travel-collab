import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { AdmissionRefusal } from "@tc/contracts";
import type { PendingAdmission } from "./admission";
import { executeTripCommand } from "./commands";
import { db } from "./db/client";
import { inviteCodes, users } from "./db/schema";
import { events } from "./db/schema";
import { recordSignIn, upsertUser } from "./users";
import { getTripDetail } from "./projections";

// No beforeEach truncation: every test mints its own id, same isolation
// strategy as the sibling suites (see eventStore.int.test.ts and
// docs/testing-baseline.md).
const signInId = () => `dev-${randomUUID()}`;

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

describe("recordSignIn (the Auth.js signIn callback)", () => {
  it("admits a sign-in and leaves the user durable behind it", async () => {
    const id = signInId();
    await expect(
      recordSignIn({ user: { id, name: "  Alice  ", email: "ALICE@Example.com" } }, admitting()),
    ).resolves.toBe(true);

    expect(await readUser(id)).toMatchObject({ id, name: "Alice", email: "alice@example.com" });
  });

  it("is idempotent across repeated sign-ins, which is the normal case", async () => {
    const id = signInId();
    await recordSignIn({ user: { id, name: "Alice" } }, admitting());
    await recordSignIn({ user: { id, name: "Alice" } }, admitting());

    expect(await db.select().from(users).where(eq(users.id, id))).toHaveLength(1);
  });

  // Unchanged by M11a and deliberately so: the no-id path is refused with
  // `false`, before the gate is even consulted, and `false` still means the
  // designed /signup?error= screen. Fail-closed was widened, not weakened.
  it("refuses a payload with no usable id rather than creating an anonymous row", async () => {
    await expect(recordSignIn({ user: { id: "  ", name: "Nobody" } })).resolves.toBe(false);
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

    await expect(recordSignIn({ user: { id, name: "Ana" } }, fakeJar(null))).resolves.toBe(true);
  });

  it("spends no code for someone who was already here", async () => {
    const id = signInId();
    await upsertUser({ id, email: null, name: "Ana", image: null });
    const code = await mintCode(id);

    await expect(recordSignIn({ user: { id, name: "Ana" } }, fakeJar(code))).resolves.toBe(true);

    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
    expect(row?.redeemedBy).toBeNull();
  });

  // The headline refusal: a brand-new account with no admission is refused and
  // LEAVES NO USERS ROW BEHIND.
  it("refuses a newcomer who presents nothing, and creates no row", async () => {
    const id = signInId();

    await expect(recordSignIn({ user: { id, name: "Nobody" } }, fakeJar(null))).resolves.toBe(
      `/signup?error=${AdmissionRefusal.enum.MISSING_INVITE_CODE}`,
    );
    expect(await readUser(id)).toBeNull();
  });

  it("refuses a newcomer who presents an unrecognised code, and creates no row", async () => {
    const id = signInId();

    await expect(
      recordSignIn({ user: { id, name: "Nobody" } }, fakeJar(`code-${randomUUID()}`)),
    ).resolves.toBe(`/signup?error=${AdmissionRefusal.enum.INVALID_INVITE_CODE}`);
    expect(await readUser(id)).toBeNull();
  });

  it("refuses a newcomer who presents a spent code, and creates no row", async () => {
    const first = signInId();
    const second = signInId();
    const code = await mintCode(first);
    await recordSignIn({ user: { id: first, name: "First" } }, fakeJar(code));

    await expect(recordSignIn({ user: { id: second, name: "Second" } }, fakeJar(code))).resolves.toBe(
      `/signup?error=${AdmissionRefusal.enum.SPENT_INVITE_CODE}`,
    );
    expect(await readUser(second)).toBeNull();
    expect(await readUser(first)).not.toBeNull();
  });

  it("admits a newcomer holding a single-use code, and burns it in the same sign-in", async () => {
    const id = signInId();
    const code = await mintCode(id);

    await expect(recordSignIn({ user: { id, name: "New" } }, fakeJar(code))).resolves.toBe(true);

    expect(await readUser(id)).not.toBeNull();
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
    expect(row?.redeemedBy).toBe(id);
  });

  // The exit-gate box: no admission credential outlives the sign-in that used
  // it. All three outcomes clear it, including the returning user who never
  // needed it.
  it("clears the pending credential on success, on refusal, and for a returning user", async () => {
    const admittedJar = fakeJar(SUPER_CODE);
    await expect(recordSignIn({ user: { id: signInId() } }, admittedJar)).resolves.toBe(true);
    expect(admittedJar.cleared).toBe(true);

    const refusedJar = fakeJar(`code-${randomUUID()}`);
    const refused = await recordSignIn({ user: { id: signInId() } }, refusedJar);
    expect(refused).not.toBe(true);
    expect(refusedJar.cleared).toBe(true);

    const returning = signInId();
    await upsertUser({ id: returning, email: null, name: null, image: null });
    const returningJar = fakeJar(SUPER_CODE);
    await expect(recordSignIn({ user: { id: returning } }, returningJar)).resolves.toBe(true);
    expect(returningJar.cleared).toBe(true);
  });

  // Every refusal is a member of the closed contract enum — never a free
  // string that happens to look like one.
  it("returns only refusals the AdmissionRefusal contract recognises", async () => {
    const spent = await mintCode(signInId());
    await recordSignIn({ user: { id: signInId() } }, fakeJar(spent));

    const refusals = await Promise.all([
      recordSignIn({ user: { id: signInId() } }, fakeJar(null)),
      recordSignIn({ user: { id: signInId() } }, fakeJar(`code-${randomUUID()}`)),
      recordSignIn({ user: { id: signInId() } }, fakeJar(spent)),
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
    await recordSignIn({ user: { id, name: "Ana", email: "ana@example.com" } }, admitting());

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
