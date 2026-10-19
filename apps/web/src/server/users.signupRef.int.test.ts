import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { users } from "./db/schema";
import { signupsByRef } from "./entitlements/admin";
import { recordSignIn, upsertUser, type SignupRefJar } from "./users";

// ADR-079: a new account keeps the channel that first brought its browser, and
// an existing one never changes. Mail is the one thing `recordSignIn` sends out
// of the process, so it is replaced, as in `users.int.test.ts`.
vi.mock("./email/send", () => ({ sendEmail: vi.fn(async () => ({ sent: true, id: null })) }));

const signInAs = (subject: string) => ({ user: { name: "Ref" }, account: { providerAccountId: subject } });

// No admission credential: open signup (ADR-063), so these stay about the ref.
const noAdmission = () => ({ read: () => Promise.resolve(null), clear: () => Promise.resolve() });

// `next/headers` has no request to read here; the jar is the seam, as for
// `pending_admission`.
function refJar(value: string | null): SignupRefJar & { cleared: boolean } {
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

async function signupRefOf(id: string): Promise<string | null | undefined> {
  const [row] = await db.select({ signupRef: users.signupRef }).from(users).where(eq(users.id, id));
  return row?.signupRef;
}

describe("recordSignIn copies the first-touch ref onto a new account (ADR-079)", () => {
  it("writes the cookie's channel to a new account, and clears the cookie", async () => {
    const id = `ref-${randomUUID()}`;
    const jar = refJar("showhn");
    await expect(recordSignIn(signInAs(id), noAdmission(), jar)).resolves.toBe(true);
    expect(await signupRefOf(id)).toBe("showhn");
    expect(jar.cleared).toBe(true);
  });

  it("never changes an existing account, and leaves its cookie alone", async () => {
    const id = `ref-${randomUUID()}`;
    await recordSignIn(signInAs(id), noAdmission(), refJar(null));
    const jar = refJar("showhn");
    await recordSignIn(signInAs(id), noAdmission(), jar);
    expect(await signupRefOf(id)).toBeNull();
    expect(jar.cleared).toBe(false);
  });

  it("drops a cookie value that is not a channel label", async () => {
    const id = `ref-${randomUUID()}`;
    await recordSignIn(signInAs(id), noAdmission(), refJar("not a channel!"));
    expect(await signupRefOf(id)).toBeNull();
  });
});

describe("signupsByRef (M50 decision 14)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  // Other files share this database, so the channel is this run's own and the
  // direct row is only checked for being there.
  it("counts each channel's signups over 7 days, 30 days and all time, with direct as null", async () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    const ref = `t-${randomUUID().slice(0, 8)}`;
    const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
    for (const days of [1, 6, 20, 45]) {
      await upsertUser({ id: `ref-${randomUUID()}`, email: null, name: null, image: null, signupRef: ref }, ago(days));
    }
    await upsertUser({ id: `ref-${randomUUID()}`, email: null, name: null, image: null }, ago(1));

    const rows = await signupsByRef(now);
    expect(rows.find((row) => row.ref === ref)).toEqual({ ref, last7Days: 2, last30Days: 3, allTime: 4 });
    expect(rows.find((row) => row.ref === null)?.last7Days).toBeGreaterThanOrEqual(1);
  });
});
