// **Turning admin on without a redeploy** (M20 link 7, Mitchell 2026-09-14).
//
// `users.is_admin` is the durable fact and needs a database write or a
// deploy-time `ADMIN_USER_IDS` change to move. The `admin-console` flag is the
// second way to say yes, set by `FLAG_ADMIN_CONSOLE`.
//
// Three properties, and the first is the one that would be a real bug:
//
//   1. **The flag answers for the whole process, so it must not reach
//      `isAdmin`** — the per-account read the console displays. If it did, every
//      row in the accounts table would be marked as an operator.
//   2. It only ever **widens**: it can grant, never revoke.
//   3. It **fails closed** — a flag that throws answers "not an operator".
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

beforeEach(() => {
  vi.mocked(adminConsoleFlag).mockClear();
});

afterEach(() => {
  flagValue.current = false;
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
  // when the flag says no — otherwise a flag failure would silently revoke
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
  // **The bug this refuses.** `admin-console` is global, so asking it about
  // somebody else's id answers with the flag's own value. The console's
  // accounts table asks exactly that question for every row — with the flag on
  // it would see the whole table marked as operators, and it would look like
  // data rather than like a bug.
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
  it("answers not-an-operator when the flag throws", async () => {
    const id = await account(false);
    flagValue.current = new Error("flag read failed");
    expect(await callerIsAdmin(id)).toBe(false);
  });

  // A stored operator is unaffected, which is the reason the column is read
  // first rather than merely the cheaper hop.
  it("keeps a stored operator working through the same failure", async () => {
    const id = await account(true);
    flagValue.current = new Error("flag read failed");
    expect(await callerIsAdmin(id)).toBe(true);
  });
});
