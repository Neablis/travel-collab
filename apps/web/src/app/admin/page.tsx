import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Heading } from "@/components/ui/heading";
import { AccountsPanel } from "@/components/admin/AccountsPanel";
import { AccountPage, NoSuchAccount } from "@/components/admin/AccountPage";
import { accountsViewHref, resolveAccountsView } from "@/components/admin/accountsView";
import { ConsoleTabs } from "@/components/admin/ConsoleTabs";
import { resolveConsoleTab, type ConsoleTab } from "@/components/admin/consoleTab";
import { TierPanel } from "@/components/admin/TierPanel";
import { RevenueStaleBanner, RevenueStrip } from "@/components/admin/RevenueStrip";
import { UnderwaterPanel } from "@/components/admin/UnderwaterPanel";
import { PriceCheckPanel, PriceCheckPending } from "@/components/admin/PriceCheckPanel";
import { LibraryTab } from "@/components/admin/LibraryTab";
import { AiModelsTab } from "@/components/admin/AiModelsTab";
import { Panel } from "@/components/ui/panel";
import { Text } from "@/components/ui/text";
import { adminAccountDetail } from "@/server/admin/accountDetail";
import { adminFinancial, adminUsers, grantablePlanIds } from "@/server/entitlements/admin";
import { aiModelsReport } from "@/server/entitlements/aiModels";
import { ASSISTANT_TOOLS } from "@/server/assistant/registry";
import { adminUserId } from "@/server/entitlements/requireAdmin";
import { priceConsistencyReport } from "@/server/billing/prices";
import { listReports } from "@/server/reports";
import { adminNotebooks } from "@/server/savedNotebooks";

// **The console, read-only over plans and granting as its only write**
// (M20 link 7, and the 2026-09-02 amendment).
//
// **Four tabs since M36 link 4 (three since link 1), not one scroll.** The scroll grew a panel per
// milestone and every new one went to the bottom, so the one part that needs
// action — reports — sat below four that only report. The tab is URL state
// (`?tab=`, D1), so each tab is its own request and reads only what it draws:
// Library the report queue, Users `adminUsers()` — the accounts table without
// the Stripe price sweep or the tier panel — and Financial `adminFinancial()`,
// which is the overview without the accounts table.
//
// **The revenue half arrived with M21 link 7**, 2026-09-14: the four-number
// strip, the per-tier MRR and margin columns, the `Pays` and `State` columns in
// the accounts table, and the segmented *"costs more than it pays"* panel. Every
// one of them needed a subscription to exist, which is why M20 shipped without
// them and why `admin.console.test.ts` refused their vocabulary until now.
//
// **What that test guards has changed rather than gone.** It no longer sweeps
// for revenue words; it asserts the things that were true for a reason and stay
// true — no `Money` on this data path, no publish or migrate over plan
// versions, and the underwater list segmented rather than merged.
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

// **Rendering micro-dollars is one module, `components/admin/microUsd.ts`.**
// It was a copy per panel, which was fine at three and stopped being fine when
// M21 needed a fourth and a fifth. It is still not `Money` and never becomes
// it: formatting is a decision made where a number is displayed, the stored
// value stays an integer count of micro-dollars all the way there (M20 link 9,
// and ADR-008's minor units round $0.0006 to zero), and the two formatters in
// that file are separate on purpose — a cost is four decimals because a request
// really does cost $0.0006, and a price is two because two more would be false
// precision on a number read at a glance.

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Before any data is read, and before anything renders. `notFound()` throws,
  // so there is no path where any of the reads below runs for a non-operator.
  if ((await adminUserId()) === null) notFound();
  const params = await searchParams;
  const tab = resolveConsoleTab(params.tab);

  if (tab === "library") {
    // The report queue is read here for the same reason the other tabs read
    // theirs — see the header — and after the gate for the same reason too.
    // `admin.console.test.ts` holds that order. Only this tab reads it: it is
    // the one read on the page that carries other people's words. The
    // notebook read (M36 link 5) joins it here, and nowhere else.
    const [open, actioned, dismissed, notebooks] = await Promise.all([
      listReports({ status: "open" }),
      listReports({ status: "actioned" }),
      listReports({ status: "dismissed" }),
      adminNotebooks(),
    ]);
    return (
      <ConsoleShell tab={tab}>
        {/* **Reports** (M12 link 6) first — the one place an operator acts on
            them — then notebooks, only the half with a source (M36 D5). */}
        <LibraryTab reports={{ open, actioned, dismissed }} notebooks={notebooks} />
      </ConsoleShell>
    );
  }

  if (tab === "ai") {
    // **The ledger, read on its own** (M36 link 4): this tab reads
    // `aiModelsReport` and nothing else — not the overview, whose revenue
    // banner is scoped to Financial and Users. The registry's names are what
    // *almost never called* is measured against, passed in because the
    // Entitlements module that reads the ledger knows no trip tools (ADR-045).
    const report = await aiModelsReport(ASSISTANT_TOOLS.map((tool) => tool.name));
    return (
      <ConsoleShell tab={tab}>
        <AiModelsTab report={report} />
      </ConsoleShell>
    );
  }

  // **An open account replaces the table, in place** (D1, M36 link 3). Its own
  // read, not the overview's: the page needs one account, not every panel and
  // Stripe's price sweep. *← All accounts* is the table's URL with the view the
  // link carried, so it comes back to the same filter and page.
  const accountId = Array.isArray(params.account) ? params.account[0] : params.account;
  if (tab === "users" && accountId !== undefined && accountId !== "") {
    const back = accountsViewHref(resolveAccountsView(params));
    const detail = await adminAccountDetail(accountId);
    return (
      <ConsoleShell tab={tab}>
        {detail === null ? (
          <NoSuchAccount back={back} />
        ) : (
          <AccountPage detail={detail} plans={grantablePlanIds()} back={back} now={new Date().toISOString()} />
        )}
      </ConsoleShell>
    );
  }

  if (tab === "users") {
    const view = resolveAccountsView(params);
    const users = await adminUsers(new Date(), view);
    return (
      // **Stale revenue is a page-level banner on both tabs that read it** —
      // Financial's MRR and Users' *Pays* column go stale together.
      <ConsoleShell tab={tab} banner={<RevenueStaleBanner revenue={users.revenue} />}>
        <Panel title="Accounts">
          {/* **One page, read for the view in the URL** (D2, M36 perf pass):
              the server searches, counts the six filters over the whole
              search, and resolves only the eight rows it draws, so a search
              or a filter is a navigation. Granting and revoking live on the
              account page a row opens (M36 link 3). */}
          <AccountsPanel
            table={users.table}
            view={view}
            windowDays={users.windowDays}
            now={new Date().toISOString()}
          />
        </Panel>
      </ConsoleShell>
    );
  }

  const financial = await adminFinancial();

  return (
    <ConsoleShell tab={tab} banner={<RevenueStaleBanner revenue={financial.revenue} />}>
      {/* **The four-number strip** (M21 link 7). ARPU appears twice and both
          are labelled, which is the link's most emphatic requirement: with
          founder, referral, trial and admin grants in the mix the two differ a
          lot, and a single unlabelled one gets quoted as whichever is
          convenient. */}
      <RevenueStrip revenue={financial.revenue} />

      {/* Two panels side by side, as the design lays them out; one column
          on a narrow window, which this route only ever sees on a small
          laptop since the console is not on the phone at all. The design's
          `repeat(auto-fit, minmax(340px, 1fr))` is an arbitrary Tailwind
          value, which the colour wall refuses (tokens only); `lg` is where
          two columns are already wider than 340px each. */}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        {/* **Segmented in the layout, not just in the query** (M21 link 7).
            A comped account is underwater by construction — a decision
            already taken, not a finding — and on this deployment every
            account predating M20's migration holds a permanent founder
            grant, so unsegmented they would swamp the list and the metric
            would be worthless. Its per-source counts are why the old
            *What the grants cost* panel was deleted (M36 link 1): the same
            numbers twice. */}
        <Panel title="Costs more than it pays">
          <UnderwaterPanel report={financial.underwater} />
        </Panel>
        <TierPanel plans={financial.plans} />
      </div>

      {/* **M21 link 2's price sweep** (KI-2026-09-16-c) — every published
          version's Stripe Price against the plan file, not only the one being
          bought at the till. Reports; never creates a Price. **Streamed**: it
          waits on Stripe for up to `PRICE_CHECK_DEADLINE_MS` (3 s), and the
          rest of the tab is the database's alone (M36 perf pass). */}
      <Suspense fallback={<PriceCheckPending />}>
        <PriceCheck />
      </Suspense>
    </ConsoleShell>
  );
}

/** The price sweep, awaited inside its own Suspense boundary. */
async function PriceCheck() {
  return <PriceCheckPanel report={await priceConsistencyReport()} />;
}

/** The heading row and the tab strip every tab shares, then the tab's body. */
function ConsoleShell({
  tab,
  banner,
  children,
}: {
  tab: ConsoleTab;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div className="flex flex-col gap-1">
          <Heading level={1}>Operator console</Heading>
          {/* M20's design subtitle, kept — it says what the page is for and
              what a non-admin gets, which is the one thing about this route that
              is easy to get wrong by omission. The M36 artboard keeps only its
              second sentence. */}
          <Text variant="secondary" className="text-sm">
            Accounts, what they hold, what they cost. Admin only — a non-admin gets nothing here,
            not a hidden link.
          </Text>
        </div>
        <ConsoleTabs value={tab} />
      </div>
      {banner}
      {children}
    </main>
  );
}
