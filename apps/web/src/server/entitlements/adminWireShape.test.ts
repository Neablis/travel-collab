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
  AdminAccountFilter as UiAdminAccountFilter,
  AdminAccountRow as UiAdminAccountRow,
  AdminAccountsPage as UiAdminAccountsPage,
  AdminGrantRow as UiAdminGrantRow,
  AdminOverview as UiAdminOverview,
} from "@/lib/adminOverview";
import type { AdminAiModelsReport as UiAiModelsReport } from "@/lib/adminAiModels";
import type { AdminNotebooksReport as UiNotebooksReport } from "@/lib/adminNotebooks";
import type {
  AccountFilterId as ServerAccountFilterId,
  AdminAccountRow as ServerAdminAccountRow,
  AdminAccountsPage as ServerAdminAccountsPage,
  AdminGrantRow as ServerAdminGrantRow,
  AdminOverview as ServerAdminOverview,
} from "./admin";
import type { AccountCost as ServerAccountCost } from "./usage";
import type { AiModelsReport as ServerAiModelsReport } from "./aiModels";
import type { AdminNotebooksReport as ServerNotebooksReport } from "../savedNotebooks";
import type {
  AdminAccountAssistant as UiAdminAccountAssistant,
  AdminAccountDetail as UiAdminAccountDetail,
  AdminAccountGrantRecord as UiAdminAccountGrantRecord,
  AdminAccountPlan as UiAdminAccountPlan,
  AdminAccountTurn as UiAdminAccountTurn,
} from "@/lib/adminAccount";
import type { AdminAccountDetail as ServerAdminAccountDetail } from "@/server/admin/accountDetail";
import type {
  AdminAccountAssistant as ServerAdminAccountAssistant,
  AdminAccountGrantRecord as ServerAdminAccountGrantRecord,
  AdminAccountPlan as ServerAdminAccountPlan,
  AdminAccountTurn as ServerAdminAccountTurn,
} from "./adminAccount";

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
const accountsPage: AssertEquals<UiAdminAccountsPage, ServerAdminAccountsPage> = true;
// The six filter ids the server's SQL selects on; `accountsView.ts` holds the
// pills to the same union from the UI side.
const filterIds: AssertEquals<UiAdminAccountFilter, ServerAccountFilterId> = true;
const cost: AssertEquals<UiAdminAccountCost, ServerAccountCost> = true;
// M36 link 4: the AI models tab reads its own report, under the same rule.
const aiModels: AssertEquals<UiAiModelsReport, ServerAiModelsReport> = true;
// M36 link 5: the Library tab's notebook read, from the module that owns the table.
const notebooks: AssertEquals<UiNotebooksReport, ServerNotebooksReport> = true;

// M36 link 3's account page. The whole detail is pinned, and its parts too, so
// a mismatch names the part rather than only the outermost type.
const detail: AssertEquals<UiAdminAccountDetail, ServerAdminAccountDetail> = true;
const accountPlan: AssertEquals<UiAdminAccountPlan, ServerAdminAccountPlan> = true;
const assistant: AssertEquals<UiAdminAccountAssistant, ServerAdminAccountAssistant> = true;
const turn: AssertEquals<UiAdminAccountTurn, ServerAdminAccountTurn> = true;
const grantRecord: AssertEquals<UiAdminAccountGrantRecord, ServerAdminAccountGrantRecord> = true;

describe("the console's wire shape", () => {
  it("is byte-identical on both sides of the lint wall", () => {
    const checks = [overview, account, grant, accountsPage, filterIds, cost, aiModels, notebooks, detail, accountPlan, assistant, turn, grantRecord];
    expect(checks).toEqual(Array.from({ length: checks.length }, () => true));
  });
});
