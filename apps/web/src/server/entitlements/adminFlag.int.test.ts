// **Turning admin on without a redeploy** (M20 link 7, Mitchell 2026-09-14).
//
// `users.is_admin` is the durable fact and needs a database write or a
// deploy-time `ADMIN_USER_IDS` change to move. The `admin-console` flag is the
// second way to say yes, targeted at a caller from the Vercel dashboard.
//
// Three properties, and the first is the one that would be a real bug:
//
//   1. **The flag answers about the CALLER, so it must not reach `isAdmin`** —
//      the per-account read the console displays. If it did, one operator with
//      the flag would see every row in the accounts table marked as an
//      operator.
//   2. It only ever **widens**: it can grant, never revoke.
//   3. It **fails closed** — an unreachable Flags service, an unconfigured
//      adapter, or an `identify` that throws all answer "not an operator".
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";

// The flag is the one thing faked here — everything else, including the
// database read it is unioned with, is real.
const flagValue = vi.hoisted(() => ({ current: false as boolean | Error }));
vi.mock("@/server/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/flags")>()),
  adminConsoleFlag: vi.fn(async () => {
    if (flagValue.current instanceof Error) throw flagValue.current;
    return flagValue.current;
  }),
}));

const { adminConsoleFlag } = await import("@/server/flags");
const { callerIsAdmin, isAdmin } = await import("./admin");

// **Every case below is a CONFIGURED deployment**, and saying so is now part
// of the fixture rather than an accident of the environment. `admin.ts` skips
// the flag entirely when `process.env.FLAGS` is unset — the credential
// `@vercel/flags-core` builds its client from — so without this the suite
// would pass for the wrong reason: the flag would never be consulted and
// "grants without a redeploy" would be asserting nothing. The unconfigured
// case gets its own describe at the bottom, where it is the subject.
beforeEach(() => {
  process.env.FLAGS = "flags_test_credential_not_a_real_one";
  vi.mocked(adminConsoleFlag).mockClear();
});

afterEach(() => {
  flagValue.current = false;
  delete process.env.FLAGS;
});

async function account(storedAdmin = false): Promise<string> {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: null, name: null, image: null });
  await db.update(users).set({ isAdmin: storedAdmin }).where(eq(users.id, id));
  return id;
}

describe("the admin-console flag grants without a redeploy", () => {
  it("makes a caller an operator with nothing written to the database", async () => {
    const id = await account(false);
    expect(await callerIsAdmin(id)).toBe(false);

    flagValue.current = true;
    expect(await callerIsAdmin(id)).toBe(true);

    // **Nothing was written.** No sign-in, no migration, no deploy — which is
    // the whole of what was asked for.
    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row!.isAdmin).toBe(false);
  });

  // **It widens and never narrows.** An operator whose bit is stored stays one
  // when the flag says no — otherwise a Flags outage would silently revoke
  // every operator at once, and "the console is empty today" is not a message
  // anyone reads as an outage. Revoking is clearing the column.
  it("cannot take admin away from an account whose bit is stored", async () => {
    const id = await account(true);
    flagValue.current = false;
    expect(await callerIsAdmin(id)).toBe(true);
  });

  it("answers for an account with no row at all", async () => {
    const ghost = `dev-${randomUUID()}`;
    expect(await callerIsAdmin(ghost)).toBe(false);
    flagValue.current = true;
    expect(await callerIsAdmin(ghost)).toBe(true);
  });
});

describe("the flag never reaches the per-account read", () => {
  // **The bug this refuses.** `admin-console` resolves THE CALLER, so asking it
  // about somebody else's id answers with the viewer's own flag value. The
  // console's accounts table asks exactly that question for every row — one
  // operator with the flag would see the whole table marked as operators, and
  // it would look like data rather than like a bug.
  it("reports the stored fact for another account, whatever the caller holds", async () => {
    const someoneElse = await account(false);
    flagValue.current = true;
    expect(await isAdmin(someoneElse)).toBe(false);
    // And the union still says yes for the caller, so this is a real split
    // rather than the flag being ignored everywhere.
    expect(await callerIsAdmin(someoneElse)).toBe(true);
  });

  it("still reports a stored operator as one", async () => {
    const stored = await account(true);
    flagValue.current = false;
    expect(await isAdmin(stored)).toBe(true);
  });
});

describe("the flag fails closed", () => {
  // The catch that covers this is not decoration: the SDK runs `identify`
  // BEFORE the code path that applies `defaultValue`, so a session read that
  // throws escapes the flag entirely and would surface as an unhandled
  // rejection rather than as "not an operator".
  it("answers not-an-operator when the flag throws", async () => {
    const id = await account(false);
    flagValue.current = new Error("flags service unreachable");
    expect(await callerIsAdmin(id)).toBe(false);
  });

  // A stored operator is unaffected by the same outage, which is the reason
  // the column is read first rather than merely the cheaper hop.
  it("keeps a stored operator working through the same outage", async () => {
    const id = await account(true);
    flagValue.current = new Error("flags service unreachable");
    expect(await callerIsAdmin(id)).toBe(true);
  });
});

// KI-2026-09-14-a. The flag answered `false` here all along — correctly — but
// the SDK logged "falling back to its defaultValue … No flag definitions
// available" on every evaluation to say so, and `/api/account/preferences` is
// hit twice per page load for every non-admin. That is dozens of lines per e2e
// run in the one place a developer is reading output.
//
// The fix asks whether Flags is configured at all before evaluating, using
// `FLAGS` — the credential `@vercel/flags-core` builds its client from
// (`createClient(process.env.FLAGS)`, checked in the installed package, not
// guessed). The entry rejected a `process.env.VERCEL` gate because a
// non-Vercel deployment with Flags genuinely configured would silently stop
// honouring the flag; that cannot happen here, because such a deployment has
// `FLAGS` set — which is what the first case below pins.
describe("an unconfigured deployment does not evaluate the flag at all", () => {
  it("answers not-an-operator without consulting it", async () => {
    const id = await account(false);
    delete process.env.FLAGS;
    // Would say yes if it were asked. The point is that it is not asked.
    flagValue.current = true;

    expect(await callerIsAdmin(id)).toBe(false);
    expect(vi.mocked(adminConsoleFlag)).not.toHaveBeenCalled();
  });

  it("still honours the flag as soon as the credential is present", async () => {
    // The other half, and the one that makes the gate a gate rather than a
    // removal: this is the non-Vercel-but-configured deployment the KI's
    // rejected `VERCEL` gate would have broken.
    const id = await account(false);
    flagValue.current = true;

    expect(await callerIsAdmin(id)).toBe(true);
    expect(vi.mocked(adminConsoleFlag)).toHaveBeenCalled();
  });

  // The stored bit is not a flag and must be unaffected by any of this.
  it("leaves a stored operator an operator", async () => {
    const id = await account(true);
    delete process.env.FLAGS;
    expect(await callerIsAdmin(id)).toBe(true);
  });
});
