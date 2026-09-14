import { notFound } from "next/navigation";
import { Heading } from "@/components/ui/heading";
import { AccountsPanel } from "@/components/admin/AccountsPanel";
import { TierPanel } from "@/components/admin/TierPanel";
import { GrantSourcePanel } from "@/components/admin/GrantSourcePanel";
import { Panel } from "@/components/ui/panel";
import { Text } from "@/components/ui/text";
import { adminOverview } from "@/server/entitlements/admin";
import { adminUserId } from "@/server/entitlements/requireAdmin";

// **The console, read-only over plans and granting as its only write**
// (M20 link 7, and the 2026-09-02 amendment).
//
// **What is deliberately NOT here, and it is the failure mode the milestone
// names**: the four-number strip the design draws — MRR and its movement, ARPU
// twice and labelled, median margin per paying account — is **M21 link 7's**.
// Same for the MRR and median-margin columns of the per-tier panel. All of them
// need a subscription to exist. The design's screen does not say which half is
// which, so an implementer working from the finished picture builds the strip
// here and breaks the split in the direction nobody checks.
// `admin.console.test.ts` fails if a revenue word appears on this page.
//
// **This reads the Entitlements module directly, and `src/app/admin/**` is on
// the lint wall's exempt shell so that it may** (Mitchell, 2026-09-14).
//
// It did not, at first. The wall says UI calls the API, so this page fetched
// its own `GET /api/admin/overview` over HTTP and forwarded the operator's
// session cookie to it — the wall's letter kept, its spirit inverted, since the
// point of "UI calls the API" is that UI runs in a browser and this does not.
// That workaround produced two defects in two days, both on the one surface
// where the credential is an operator's: a session cookie sent to an origin
// derived from request headers (CodeRabbit, PR #174), and then — once the
// origin came from configuration — a 500 on every preview load, because the
// configured value was the per-deployment host and Vercel's protection cookie
// is issued for the branch alias.
//
// Neither defect is possible now, because neither ingredient exists: no second
// request, no cookie crossing a network boundary, no origin to choose. A server
// component calling a server function is the boring version, and the boring
// version is the one with no hosts in it.
//
// **The gate is still checked here, not inherited from the layout**, and it is
// the same `callerIsAdmin` the endpoint uses. The gate box requires a non-admin
// to reach a 404 for the ROUTE as well as for the endpoint — `adminUserId()`
// returning null is that 404, and `GET /api/admin/overview` still answers its
// own, so removing the fetch removed a caller and not a check.

// **Rendering micro-dollars moved to the panels that show them**, one copy
// each in `AccountsPanel`, `TierPanel` and `UnderwaterPanel`. It is still not
// `Money` and never becomes it: formatting is a decision made where a number is
// displayed, and the stored value stays an integer count of micro-dollars all
// the way there (M20 link 9, and ADR-008's minor units round $0.0006 to zero).

export default async function AdminPage() {
  // Before any data is read, and before anything renders. `notFound()` throws,
  // so there is no path where `adminOverview()` runs for a non-operator.
  if ((await adminUserId()) === null) notFound();
  const overview = await adminOverview();

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Heading level={1}>Operator console</Heading>
        {/* The design's subtitle, verbatim — it says what the page is for and
            what a non-admin gets, which is the one thing about this route that
            is easy to get wrong by omission. */}
        <Text variant="secondary" className="text-sm">
          Accounts, what they hold, what they cost. Admin only — a non-admin gets nothing here,
          not a hidden link.
        </Text>
      </div>

      {/* **No four-number strip.** MRR, ARPU twice and median margin per paying
          account are M21 link 7's — every one of them needs a subscription to
          exist. The design draws them here and does not say which half is
          which, which is exactly how an implementer working from the finished
          screen breaks the split. `admin.console.test.ts` fails if a revenue
          word reaches this page. */}

      <Panel title="Accounts">
        {/* Search, counted filters, 8 rows a page and a no-match state all live
            in the client component: they are view state over a list the server
            already sent, and a round trip per keystroke would be a worse
            console for a table bounded at 100 rows. Only enabled plans are
            offered to the grant dialog — `enabled` bounds what an operator may
            hand out, never what a holder may do, which is what lets the
            disabled fourth-plan proof ship without anyone receiving it. */}
        {/* `plansGrantingNothing` is decided once, here, from the plan file, and
            asked as "does this plan grant anything" rather than "is this plan
            free" — ADR-045 rule 4, which `planVersions.fourthPlan.test.ts`
            enforces by walking every source file for a plan-id comparison. It
            refused the first version of the Free filter, which compared
            `planId === "free"` directly. */}
        <AccountsPanel
          accounts={overview.accounts}
          windowDays={overview.windowDays}
          plans={overview.plans.filter((plan) => plan.live.enabled).map((plan) => plan.planId)}
          plansGrantingNothing={overview.plans
            .filter((plan) => plan.live.entitlements.length === 0)
            .map((plan) => plan.planId)}
        />
      </Panel>

      {/* Two panels side by side, as the design lays them out; one column on a
          narrow window, which this route only ever sees on a small laptop since
          the console is not on the phone at all. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <GrantSourcePanel sources={overview.grantSources} />
        <TierPanel plans={overview.plans} />
      </div>
    </main>
  );
}
