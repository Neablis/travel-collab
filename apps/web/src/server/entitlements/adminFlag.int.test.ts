// **Turning admin on without a redeploy** (M20 link 7, Mitchell 2026-09-14),
// as M59 left it: per caller, from `ADMIN_USER_IDS`.
//
// `users.is_admin` is the durable fact and needs a database write to move.
// `ADMIN_USER_IDS` is the second way to say yes, read per request: a
// comma-separated list of user ids, each matched exactly. It is named people, never
// "everyone" — sign-up is open, so a switch that made every signed-in caller an
// operator would hand the console to any stranger.
//
// Three properties, and the first is the one that would be a real bug:
//
//   1. **The list answers for the caller only, so it must not reach
//      `isAdmin`** — the per-account read the console displays. If it did,
//      every listed row would be marked as an operator by the viewer's list.
//   2. It only ever **widens**: it can grant, never revoke.
//   3. It **fails closed** — unset, empty or malformed is nobody.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";

const { callerIsAdmin, isAdmin } = await import("./admin");

afterEach(() => {
  vi.unstubAllEnvs();
});

async function account(storedAdmin = false): Promise<string> {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: null, name: null, image: null });
  await db.update(users).set({ isAdmin: storedAdmin }).where(eq(users.id, id));
  return id;
}

const listed = (...entries: string[]) => vi.stubEnv("ADMIN_USER_IDS", entries.join(","));

describe("ADMIN_USER_IDS grants per caller, without a redeploy", () => {
  it("makes the listed caller an operator and not the unlisted one, with nothing written", async () => {
    const a = await account();
    const b = await account();
    expect(await callerIsAdmin(a)).toBe(false);

    listed(a);
    expect(await callerIsAdmin(a)).toBe(true);
    expect(await callerIsAdmin(b)).toBe(false);

    // **Nothing was written.** No sign-in, no migration, no deploy.
    const [row] = await db.select().from(users).where(eq(users.id, a));
    expect(row!.isAdmin).toBe(false);
  });

  it("is nobody when unset, empty, or only separators", async () => {
    const a = await account();
    for (const raw of [undefined, "", "  ", ",", " , ,"]) {
      vi.stubEnv("ADMIN_USER_IDS", raw);
      expect(await callerIsAdmin(a), JSON.stringify(raw)).toBe(false);
    }
  });

  it("never matches a wildcard, a prefix of a listed id, or an empty caller id", async () => {
    const a = await account();
    listed("*", a.slice(0, a.length - 1), ",");
    expect(await callerIsAdmin(a)).toBe(false);
    expect(await callerIsAdmin("")).toBe(false);
  });

  // **It widens and never narrows.** An operator whose bit is stored stays one
  // when the list says nothing — otherwise a forgotten variable would silently
  // revoke every operator at once. Revoking is clearing the column.
  it("cannot take admin away from an account whose bit is stored", async () => {
    const id = await account(true);
    vi.stubEnv("ADMIN_USER_IDS", "someone-else");
    expect(await callerIsAdmin(id)).toBe(true);
  });

  it("answers for an account with no row at all, by id only", async () => {
    const ghost = `dev-${randomUUID()}`;
    expect(await callerIsAdmin(ghost)).toBe(false);
    listed(ghost);
    expect(await callerIsAdmin(ghost)).toBe(true);
  });
});

describe("the list never reaches the per-account read", () => {
  // **The bug this refuses.** The console's accounts table asks `isAdmin` about
  // every row. If the list leaked into it, every account the viewer's list
  // named would be painted as an operator, and it would look like data rather
  // than like a bug.
  it("reports the stored fact for another account, whatever the caller holds", async () => {
    const someoneElse = await account(false);
    listed(someoneElse);
    expect(await isAdmin(someoneElse)).toBe(false);
    // And the union still says yes for the caller, so this is a real split
    // rather than the list being ignored everywhere.
    expect(await callerIsAdmin(someoneElse)).toBe(true);
  });

  it("still reports a stored operator as one", async () => {
    const stored = await account(true);
    expect(await isAdmin(stored)).toBe(true);
  });
});
