// **The operator console** (M20 link 7), against a real database.
//
// Three gate boxes: the console answers from real data, a non-admin reaches no
// route and no endpoint, and granting is the only write.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { entitlementGrants, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import type { TurnLedger } from "@/server/assistant/ledger";
import { recordAiUsage } from "./usage";
import { allGrantsFor, issueGrant, offerTrial } from "./grants";
import { accountCan } from "./resolver";
import { adminAccounts, adminTopSpenders, grantSourcePanel, isAdmin, planPanel } from "./admin";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET: OVERVIEW } = await import("@/app/api/admin/overview/route");
const { POST: GRANT, DELETE: REVOKE } = await import("@/app/api/admin/grants/route");

const newUser = () => `dev-${randomUUID()}`;

async function account(options: { admin?: boolean; planId?: "free" | "plus" | "premium" } = {}) {
  const id = newUser();
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  await db
    .update(users)
    .set({ isAdmin: options.admin ?? false, planId: options.planId ?? "free", planVersion: 1 })
    .where(eq(users.id, id));
  return id;
}

function usage(userId: string): TurnLedger {
  return {
    cost: {
      userId,
      endpoint: "ask",
      outcome: "completed",
      taskClass: "question",
      turn: { model: "deepseek/deepseek-v4-flash-0731", tokensIn: 3363, tokensOut: 512 },
      classifier: { model: "zai/glm-4.7-flash", tokensIn: 198, tokensOut: 49 },
      steps: 2,
      planVersionRef: "plus@v1",
    },
    capacity: [],
    toolCalls: [],
  };
}

const grantBody = (userId: string, planId: string, expiresAt: string | null = null) =>
  new Request("http://localhost/api/admin/grants", {
    method: "POST",
    body: JSON.stringify({ userId, planId, expiresAt, reason: "Comped for a support case." }),
  });

describe("a non-admin reaches no admin endpoint", () => {
  // **The gate box, and it is explicit that hiding is not enough**: *"checked
  // server-side, and a test proves the route group is not merely hidden."*
  it("404s every admin endpoint for a signed-in non-admin", async () => {
    currentUserId = await account();
    expect((await OVERVIEW()).status).toBe(404);
    expect((await GRANT(grantBody(currentUserId, "premium"))).status).toBe(404);
    expect(
      (
        await REVOKE(
          new Request("http://localhost/api/admin/grants", {
            method: "DELETE",
            body: JSON.stringify({ grantId: randomUUID() }),
          }),
        )
      ).status,
    ).toBe(404);
  });

  it("404s every admin endpoint for nobody at all", async () => {
    currentUserId = "";
    expect((await OVERVIEW()).status).toBe(404);
    expect((await GRANT(grantBody("someone", "premium"))).status).toBe(404);
  });

  // **404, not 403.** A 403 confirms the route exists, and an operator console
  // whose existence is confirmable is a list of endpoints worth attacking.
  it("says nothing about the route existing", async () => {
    currentUserId = await account();
    const res = await OVERVIEW();
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toMatch(/admin|forbidden|permission/i);
  });

  it("lets an admin through the same endpoint", async () => {
    currentUserId = await account({ admin: true });
    expect(await isAdmin(currentUserId)).toBe(true);
    expect((await OVERVIEW()).status).toBe(200);
  });

  // The operator bit is not acquirable by signing in, and there is no path
  // that sets it. It is a column an operator sets by hand.
  it("gives a new account no operator bit", async () => {
    const id = await account();
    expect(await isAdmin(id)).toBe(false);
  });
});

describe("the console answers from real data", () => {
  it("counts accounts per plan and carries each plan's version history", async () => {
    await account({ planId: "premium" });
    const panel = await planPanel();
    const premium = panel.find((row) => row.planId === "premium")!;
    expect(premium.accounts).toBeGreaterThan(0);
    expect(premium.live.version).toBe(1);
    expect(premium.versions.map((v) => v.version)).toEqual([1]);
    // Read-only over plans: the panel carries no field anything could write.
    expect(Object.keys(premium)).toEqual(["planId", "versions", "live", "accounts"]);
  });

  it("counts accounts per ACTIVE grant source", async () => {
    const trialled = await account();
    await offerTrial(trialled);
    const before = (await grantSourcePanel())["trial"] ?? 0;
    expect(before).toBeGreaterThan(0);

    // An expired trial stops being counted — and the row is still there,
    // because nothing sweeps that table. "On a trial now" and "ever had one"
    // are different questions and this panel asks the first.
    const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const after = (await grantSourcePanel(later))["trial"] ?? 0;
    expect(after).toBeLessThan(before);
    expect(await allGrantsFor(trialled)).toHaveLength(1);
  });

  it("reports cost per account and ranks the top spenders", async () => {
    const heavy = await account({ planId: "plus" });
    for (let i = 0; i < 3; i += 1) await recordAiUsage(usage(heavy));
    const spenders = await adminTopSpenders(50);
    const entry = spenders.find((row) => row.userId === heavy);
    expect(entry!.requests).toBe(3);
    expect(entry!.microUsd).toBeGreaterThan(0);
  });

  // **Resolved through the real resolver**, never reassembled. A second
  // implementation of the union is a second thing that can disagree with the
  // gates, and it is always the one nobody is looking at.
  it("shows what each account may actually do", async () => {
    const id = await account({ planId: "premium" });
    const rows = await adminAccounts(200);
    const row = rows.find((account) => account.userId === id)!;
    expect(row.planVersionRef).toBe("premium@v1");
    expect([...row.entitlements].sort()).toEqual(["ai.ask", "ai.command", "trip.collaborators"]);
    expect(await accountCan(id, "trip.collaborators")).toBe(true);
  });
});

describe("granting is the only write", () => {
  it("grants a plan at the live version, with an expiry and a reason", async () => {
    const admin = await account({ admin: true });
    const target = await account();
    currentUserId = admin;

    expect(await accountCan(target, "trip.collaborators")).toBe(false);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await GRANT(grantBody(target, "premium", expiresAt));
    expect(res.status).toBe(201);

    // **Applies on the next request, with no sign-out and no token refresh.**
    expect(await accountCan(target, "trip.collaborators")).toBe(true);

    const [grant] = await allGrantsFor(target);
    expect(grant!.source).toBe("admin");
    // Who did it, and why — an audit column that would be a lie if it named
    // nobody.
    expect(grant!.grantedBy).toBe(admin);
    expect(grant!.reason).toBe("Comped for a support case.");
    // **Pinned**, not "the newest at read time".
    expect(grant!.planVersion).toBe(1);

    // And it lapses on its own, with no job.
    const after = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await accountCan(target, "trip.collaborators", after)).toBe(false);
  });

  // `enabled` bounds what an operator may hand out, never what a holder may
  // do. That is what lets the fourth-plan proof ship without anyone receiving
  // it.
  it("refuses to hand out a disabled plan", async () => {
    currentUserId = await account({ admin: true });
    const target = await account();
    const res = await GRANT(grantBody(target, "studio"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("plan-not-available");
    expect(await allGrantsFor(target)).toHaveLength(0);
  });

  it("refuses a grant with no reason", async () => {
    currentUserId = await account({ admin: true });
    const res = await GRANT(
      new Request("http://localhost/api/admin/grants", {
        method: "POST",
        body: JSON.stringify({ userId: "someone", planId: "premium", expiresAt: null, reason: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  // **Revoking marks, it never deletes.** The row is what answers "has this
  // account ever held a trial", and removing it would hand the trial back.
  it("revokes by marking the row rather than removing it", async () => {
    currentUserId = await account({ admin: true });
    const target = await account();
    await issueGrant({
      userId: target,
      planId: "premium",
      planVersion: 1,
      source: "admin",
      grantedBy: currentUserId,
      expiresAt: null,
    });
    const [grant] = await allGrantsFor(target);
    const res = await REVOKE(
      new Request("http://localhost/api/admin/grants", {
        method: "DELETE",
        body: JSON.stringify({ grantId: grant!.id }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await accountCan(target, "trip.collaborators")).toBe(false);
    const [still] = await db.select().from(entitlementGrants).where(eq(entitlementGrants.id, grant!.id));
    expect(still).toBeDefined();
    expect(still!.revokedBy).toBe(currentUserId);
  });
});
