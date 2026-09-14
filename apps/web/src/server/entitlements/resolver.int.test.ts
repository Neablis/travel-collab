// The two stores, against a real database (ADR-045 rule 1).
//
// The union and the ceilings are unit-tested in `resolver.test.ts`; what needs
// a database is the part a pure function cannot show — that expiry is resolved
// on read with no job running, that a revoked grant stops counting, that the
// trial is one time ever under a race, and that nothing anywhere deletes a row.
//
// No `beforeEach` truncation: every test mints its own id, the same isolation
// strategy as the sibling suites.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import { can } from "./capability";
import {
  TRIAL_DAYS,
  activeGrantsFor,
  allGrantsFor,
  hasEverHeldTrial,
  issueGrant,
  offerTrial,
  revokeGrant,
} from "./grants";
import { accountCan, entitlementsFor } from "./resolver";

const newUser = () => `dev-${randomUUID()}`;

async function makeAccount(id: string = newUser()): Promise<string> {
  await upsertUser({ id, email: null, name: null, image: null });
  return id;
}

const DAY = 24 * 60 * 60 * 1000;

describe("a new account", () => {
  it("is created on free, at the version the file publishes today", async () => {
    const id = await makeAccount();
    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row!.planId).toBe("free");
    expect(row!.planVersion).toBe(1);
    expect(row!.isAdmin).toBe(false);
  });

  // **Insert-only.** A returning sign-in must not reset a paying account to
  // free — the columns are absent from `upsertUser`'s `onConflictDoUpdate` set
  // list, and this is the assertion that keeps them absent.
  it("keeps its plan when it signs in again", async () => {
    const id = await makeAccount();
    await db.update(users).set({ planId: "premium", planVersion: 1 }).where(eq(users.id, id));
    await upsertUser({ id, email: "someone@example.com", name: "Renamed", image: null });
    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row!.planId).toBe("premium");
    expect(row!.name).toBe("Renamed");
  });
});

describe("the resolver reads both stores", () => {
  it("gives a bare free account no AI and no collaborators", async () => {
    const id = await makeAccount();
    expect(await accountCan(id, "ai.ask")).toBe(false);
    expect(await accountCan(id, "trip.collaborators")).toBe(false);
  });

  // **No sign-out and no token refresh.** The resolver reads the database on
  // the request, so a grant written a millisecond ago is in force on the next
  // call — which is exactly the gate box, minus the browser.
  it("answers the very next request after a grant is written", async () => {
    const id = await makeAccount();
    expect(await accountCan(id, "trip.collaborators")).toBe(false);
    await issueGrant({
      userId: id,
      planId: "premium",
      planVersion: 1,
      source: "admin",
      grantedBy: "operator",
      expiresAt: new Date(Date.now() + DAY),
    });
    expect(await accountCan(id, "trip.collaborators")).toBe(true);
  });

  // **Expiry is resolved, not swept.** Nothing was revoked by hand and no job
  // ran — the same row answers differently because the clock moved.
  it("refuses again the moment a grant's expiry passes", async () => {
    const id = await makeAccount();
    const expiresAt = new Date(Date.now() + DAY);
    await issueGrant({
      userId: id,
      planId: "premium",
      planVersion: 1,
      source: "admin",
      expiresAt,
    });
    expect(await accountCan(id, "ai.ask", new Date(expiresAt.getTime() - 1000))).toBe(true);
    expect(await accountCan(id, "ai.ask", new Date(expiresAt.getTime() + 1000))).toBe(false);
    // And the row is still there afterwards, which is the half that matters.
    expect(await allGrantsFor(id)).toHaveLength(1);
  });

  it("stops counting a revoked grant without removing it", async () => {
    const id = await makeAccount();
    await issueGrant({ userId: id, planId: "premium", planVersion: 1, source: "admin", expiresAt: null });
    const [row] = await allGrantsFor(id);
    expect(await revokeGrant(row!.id, "operator")).toBe(true);
    expect(await accountCan(id, "ai.ask")).toBe(false);
    expect(await activeGrantsFor(id)).toHaveLength(0);
    expect(await allGrantsFor(id)).toHaveLength(1);
    // A second revoke is a no-op rather than a rewrite of who did it and when.
    expect(await revokeGrant(row!.id, "someone-else")).toBe(false);
  });

  // A missing row is not an error: sessions outlive rows (ADR-025), and the
  // answer is what a brand-new row would have said.
  it("treats a session with no row as bare free rather than throwing", async () => {
    const resolved = await entitlementsFor(`dev-${randomUUID()}`);
    expect(resolved.held.planId).toBe("free");
    expect(can(resolved.entitlements, "ai.ask")).toBe(false);
  });
});

describe("the trial is one time ever per account", () => {
  it("is issued at signup and runs for a week", async () => {
    const id = newUser();
    const now = new Date("2026-09-13T12:00:00Z");
    await makeAccount(id);
    await offerTrial(id, now);
    const [row] = await allGrantsFor(id);
    expect(row!.source).toBe("trial");
    expect(row!.planId).toBe("plus");
    expect(row!.expiresAt!.getTime() - now.getTime()).toBe(TRIAL_DAYS * DAY);
    expect(await accountCan(id, "ai.ask", now)).toBe(true);
    // Seven days later, with nothing having run.
    expect(await accountCan(id, "ai.ask", new Date(now.getTime() + TRIAL_DAYS * DAY + 1000))).toBe(false);
  });

  // **The rule, and the way it dies.** Eligibility reads expired and revoked
  // rows alike. An account that trials, lapses, subscribes, cancels and comes
  // back is not offered another week.
  it("is not offered again after it has expired", async () => {
    const id = await makeAccount();
    const long = new Date("2020-01-01T00:00:00Z");
    await offerTrial(id, long);
    expect(await hasEverHeldTrial(id)).toBe(true);
    expect(await offerTrial(id, new Date())).toBe(false);
    expect(await allGrantsFor(id)).toHaveLength(1);
  });

  it("is not offered again after it has been revoked", async () => {
    const id = await makeAccount();
    await offerTrial(id);
    const [row] = await allGrantsFor(id);
    await revokeGrant(row!.id, "operator");
    expect(await offerTrial(id, new Date())).toBe(false);
    expect(await allGrantsFor(id)).toHaveLength(1);
  });

  // **The guarantee is the index, not the read.** Two concurrent sign-ins both
  // pass `hasEverHeldTrial` before either writes; only the partial unique index
  // stops both writing. The loser is silent, because a returning account simply
  // does not get another week and that is not a failure to report.
  it("issues exactly one under a concurrent race", async () => {
    const id = await makeAccount();
    const results = await Promise.all([offerTrial(id), offerTrial(id), offerTrial(id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await allGrantsFor(id)).toHaveLength(1);
  });

  // The trial grants `plus`, so `trip.collaborators` is never trialled —
  // nobody experiences collaboration before paying for it, which is why the
  // collaboration gate's refusal has to name the tier.
  it("never confers trip.collaborators", async () => {
    const id = await makeAccount();
    await offerTrial(id);
    expect(await accountCan(id, "ai.ask")).toBe(true);
    expect(await accountCan(id, "trip.collaborators")).toBe(false);
  });

  // The other half of the boundary: the account may hold any number of admin
  // comps. The unique index is partial on `source` for exactly this reason.
  it("does not constrain the other three sources", async () => {
    const id = await makeAccount();
    const comp = { userId: id, planId: "premium" as const, planVersion: 1, source: "admin" as const, expiresAt: null };
    expect(await issueGrant(comp)).toBe(true);
    expect(await issueGrant(comp)).toBe(true);
    expect(await allGrantsFor(id)).toHaveLength(2);
  });
});

describe("the founder backfill", () => {
  // **This runs the migration's own statement, not a snapshot of what the
  // local database happens to hold.** Written the other way first — read every
  // `source: "founder"` row and assert its shape — and it passed against a
  // database whose `users` table was empty when 0019 ran, so it asserted
  // nothing at all. A test over zero rows is green for the wrong reason, which
  // is exactly what CLAUDE.md rule 3 exists to catch.
  //
  // So the statement is lifted out of the migration file by text and executed
  // here against accounts created a moment ago. If someone edits the backfill,
  // this test runs the edit.
  const backfill = (): string => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../drizzle/0019_account_plans_and_grants.sql", import.meta.url)),
      "utf8",
    );
    const statement = sql.slice(sql.indexOf('INSERT INTO "entitlement_grants"'));
    if (!statement.startsWith('INSERT INTO "entitlement_grants"')) {
      throw new Error("0019 no longer carries the founder backfill — read the gate box.");
    }
    return statement;
  };

  it("leaves no pre-existing account on bare free", async () => {
    const before = [await makeAccount(), await makeAccount()];
    for (const id of before) {
      // Bare free: exactly what an account looks like the instant before the
      // backfill reaches it.
      expect(await accountCan(id, "ai.ask")).toBe(false);
    }

    await db.execute(sql.raw(backfill()));

    for (const id of before) {
      const [grant] = await allGrantsFor(id);
      expect(grant!.source).toBe("founder");
      // `premium@v1` is the version granting all three entitlements, which is
      // what makes "loses no capability it had the day before" literally true:
      // the day before, `permitEverything` was the resolver.
      expect(grant!.planId).toBe("premium");
      expect(grant!.planVersion).toBe(1);
      // Permanent. A founder grant is not a trial and never lapses.
      expect(grant!.expiresAt).toBeNull();
      expect(await accountCan(id, "ai.ask")).toBe(true);
      expect(await accountCan(id, "ai.command")).toBe(true);
      expect(await accountCan(id, "trip.collaborators")).toBe(true);
    }
  });

  // Idempotent, because a restored snapshot replayed by hand would otherwise
  // hand every account a second founder grant.
  it("adds nothing when it runs twice", async () => {
    const id = await makeAccount();
    await db.execute(sql.raw(backfill()));
    const after_first = (await allGrantsFor(id)).length;
    await db.execute(sql.raw(backfill()));
    expect((await allGrantsFor(id)).length).toBe(after_first);
    expect(after_first).toBe(1);
  });
});
