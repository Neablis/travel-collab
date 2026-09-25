// **The account sheet's view of an account's grants**
// (KI-20260916-b-the-account-sheet-never-names-the-grants-an-account-holds).
//
// The reported account held `free@v1` with an admin `premium` comp and a
// founder grant, and the sheet could name neither: `entitlementsFor` returned
// the grants and `accountPlanView` put only their version refs on the wire, so
// where each came from and when it ended never left the server. The rendering
// half is `PlanSection.test.tsx`; this is the half that has to carry the data.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { upsertUser } from "@/server/users";
import { issueGrant } from "./grants";
import { accountPlanView } from "./accountPlan";

describe("accountPlanView's grants", () => {
  it("carries every active grant's plan, version, source and expiry", async () => {
    const id = `dev-${randomUUID()}`;
    await upsertUser({ id, email: null, name: null, image: null });
    const ends = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await issueGrant({ userId: id, planId: "premium", planVersion: 1, source: "admin", grantedBy: "test", expiresAt: null });
    await issueGrant({ userId: id, planId: "plus", planVersion: 1, source: "founder", expiresAt: ends });

    const view = await accountPlanView(id);

    expect(view.planVersionRef).toBe("free@v1");
    expect(view.grants).toEqual(
      expect.arrayContaining([
        { planId: "premium", version: 1, source: "admin", expiresAt: null },
        { planId: "plus", version: 1, source: "founder", expiresAt: ends.toISOString() },
      ]),
    );
    expect(view.grants).toHaveLength(2);
  });
});
