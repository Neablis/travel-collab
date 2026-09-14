// **A test fixture for an account that may collaborate** (M20 link 6).
//
// Integration suites seed trips with `executeTripCommand(..., "some-owner")`,
// which mints no `users` row: a trip's owner is an `actor_id` in the log and
// nothing else. Before M20 that was complete, because nothing ever asked what
// an owner's account held.
//
// It is not complete now. `entitlementsFor` treats a session with no row as
// bare `free` — deliberately, and for the reason `readPreferences` takes the
// same position: sessions outlive rows (ADR-025), and the least an account can
// hold is the honest answer. So an owner with no row is a free owner, their
// granted collaborators cap to `viewer` on read, and `POST /invites` refuses
// them with 402. All three are the gate working.
//
// Suites that are about invites, members, shares or access — not about
// entitlements — say so here instead of asserting around it.
//
// **Under `src/server/`, not `src/test-support/`.** It imports the database,
// `upsertUser` and the grant writer, and everything outside `src/server` is
// behind AGENTS.md's lint wall — a fixture is not an exemption from it.
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import type { PlanId } from "@tc/contracts";

/**
 * Give these ids a `users` row on `premium`, so the collaboration gate lets
 * them through.
 *
 * `users.plan_id` rather than a grant, because that is what a subscription
 * moves and it is the shorter path for a fixture. `entitledByGrant` below is
 * for the suites that want the other one.
 */
export async function entitleAccounts(
  ids: readonly string[],
  planId: PlanId = "premium",
): Promise<void> {
  for (const id of ids) {
    await upsertUser({ id, email: null, name: null, image: null });
    await db.update(users).set({ planId, planVersion: 1 }).where(eq(users.id, id));
  }
}

/** The same, through a permanent admin grant — the path an operator uses. */
export async function entitleByGrant(id: string, planId: PlanId = "premium"): Promise<void> {
  await upsertUser({ id, email: null, name: null, image: null });
  await issueGrant({
    userId: id,
    planId,
    planVersion: 1,
    source: "admin",
    grantedBy: "test-fixture",
    expiresAt: null,
  });
}
