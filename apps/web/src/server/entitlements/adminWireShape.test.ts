// **The operator console's two declarations of one shape, pinned together.**
//
// `src/lib/adminOverview.ts` restates the server's types because AGENTS.md's
// lint wall forbids `src/app/admin/page.tsx` importing `@/server/*` — the page
// reads its own API instead. Two declarations of one shape drift, and the one
// that drifts is the one nobody is looking at.
//
// **This lives under `src/server/` on purpose.** It is the only file that has
// to see both sides, and `src/server/**` is the wall's exempt shell — putting
// it beside the console's other tests meant a UI file importing server
// internals, which is the rule rather than an exception to it. That the wall
// caught it is the wall working.
//
// **A compile-time identity check, not a comparison of field names.** The first
// version listed the top-level keys of two interfaces and compared the lists,
// so it passed when a field changed TYPE, became nullable or changed nested
// shape — and it never looked at `AdminGrantRow`, `AdminPlanPanelRow` or
// `AdminAccountCost` at all. Caught by CodeRabbit on PR #174, and fixing it
// immediately surfaced four real mismatches: the UI had `string` where the
// server has `PlanId`, and `readonly string[]` where it has
// `readonly Entitlement[]`.
import { describe, expect, it } from "vitest";
import type {
  AdminAccountCost as UiAdminAccountCost,
  AdminAccountRow as UiAdminAccountRow,
  AdminGrantRow as UiAdminGrantRow,
  AdminOverview as UiAdminOverview,
} from "@/lib/adminOverview";
import type {
  AdminAccountRow as ServerAdminAccountRow,
  AdminGrantRow as ServerAdminGrantRow,
  AdminOverview as ServerAdminOverview,
} from "./admin";
import type { AccountCost as ServerAccountCost } from "./usage";

/**
 * Two types are identical only if a generic function returning a conditional
 * over each is assignable both ways — the standard conditional-type identity
 * trick, and the only form that refuses a merely-assignable widening.
 */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertEquals<A, B> = Equals<A, B> extends true ? true : { mismatch: [A, B] };

// **Enforced by `tsc`.** Each line fails to COMPILE when the two sides differ;
// the `it` below exists only so the suite reports something when it runs.
const overview: AssertEquals<UiAdminOverview, ServerAdminOverview> = true;
const account: AssertEquals<UiAdminAccountRow, ServerAdminAccountRow> = true;
const grant: AssertEquals<UiAdminGrantRow, ServerAdminGrantRow> = true;
const cost: AssertEquals<UiAdminAccountCost, ServerAccountCost> = true;

describe("the console's wire shape", () => {
  it("is byte-identical on both sides of the lint wall", () => {
    expect([overview, account, grant, cost]).toEqual([true, true, true, true]);
  });
});
