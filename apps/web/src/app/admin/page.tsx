import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Heading } from "@/components/ui/heading";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { GrantForm } from "@/components/admin/GrantForm";
import type { AdminOverview } from "@/lib/adminOverview";

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
// **A server component that reads its own API**, rather than the Entitlements
// module directly. AGENTS.md's lint wall forbids a page importing `@/server/*`
// — UI calls the API — and that is not a rule to bend for a console. The hop
// costs one internal request per load on an operator tool, which is nothing,
// and it buys the property the gate box actually wants: the ENDPOINT is the
// server-side check, so the route and the endpoint cannot disagree about who is
// an operator.
//
// The origin comes from `headers()`, the same way the signup page's Server
// Action derives its cookie host — `BASE_URL` is a local-dev default and would
// be wrong on Vercel. The cookie header is forwarded because the endpoint
// authenticates the caller and a server-side `fetch` carries no jar of its own.

async function loadOverview(): Promise<AdminOverview> {
  const incoming = await headers();
  const host = incoming.get("host");
  const proto = incoming.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const res = await fetch(`${proto}://${host}/api/admin/overview`, {
    headers: { cookie: incoming.get("cookie") ?? "" },
    // An operator console must never render a cached view of who holds what:
    // a grant made a moment ago has to be visible, and a revoked one gone.
    cache: "no-store",
  });
  // **404 for a non-admin**, which is what the endpoint answers and what this
  // route then becomes. Any other non-200 is a real failure and throws.
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`admin overview: ${res.status}`);
  return ((await res.json()) as { overview: AdminOverview }).overview;
}

function microUsd(value: number): string {
  // Micro-dollars, rendered. **Not `Money`** — this is a display decision made
  // where it is displayed, and the stored number stays an integer count of
  // micro-dollars all the way here (M20 link 9).
  return `$${(value / 1_000_000).toFixed(4)}`;
}

export default async function AdminPage() {
  const overview = await loadOverview();

  return (
    <main className="flex flex-col gap-8">
      <Heading level={1}>Operator console</Heading>

      <section className="flex flex-col gap-2" aria-labelledby="plans-heading">
        <Heading level={2} id="plans-heading">
          Plans
        </Heading>
        {/* Read-only. Versions are a committed file; publishing is a commit and
            a deploy, and there is no write path to any of this. */}
        <p className="text-xs text-slate">
          Plan versions are a committed file. This shows what is live; publishing a new version is a
          deploy.
        </p>
        <Table className="text-xs">
          <THead>
            <TR>
              <TH>Plan</TH>
              <TH>Live version</TH>
              <TH>Entitlements</TH>
              <TH>Requests/day</TH>
              <TH>Steps/day</TH>
              <TH>Accounts</TH>
              <TH>History</TH>
            </TR>
          </THead>
          <TBody>
            {overview.plans.map((plan) => (
              <TR key={plan.planId} data-testid={`plan-${plan.planId}`}>
                <TD className="text-ink">
                  {plan.planId}
                  {!plan.live.enabled && <span className="ml-1 text-slate">(disabled)</span>}
                </TD>
                <TD className="text-ink">v{plan.live.version}</TD>
                <TD className="text-ink">
                  {plan.live.entitlements.length === 0 ? "—" : plan.live.entitlements.join(", ")}
                </TD>
                <TD className="text-ink">{plan.live.ceilings.perUserRequestsPerDay ?? "env"}</TD>
                <TD className="text-ink">{plan.live.ceilings.perUserStepsPerDay ?? "env"}</TD>
                <TD className="text-ink">{plan.accounts}</TD>
                <TD className="text-slate">
                  {plan.versions.map((version) => `v${version.version} (${version.publishedAt})`).join(", ")}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="grants-heading">
        <Heading level={2} id="grants-heading">
          Accounts per active grant source
        </Heading>
        {/* ACTIVE, so an expired trial is not counted as one somebody holds —
            and the row it reads is still there, because nothing sweeps that
            table. "How many are on a trial now" and "how many ever had one" are
            different questions and this is the first. */}
        <ul className="flex flex-col gap-1 text-xs" data-testid="grant-sources">
          {["trial", "referral", "admin", "founder"].map((source) => (
            <li key={source} className="text-ink">
              {source}: {overview.grantSources[source] ?? 0}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="spenders-heading">
        <Heading level={2} id="spenders-heading">
          Top spenders — trailing {overview.windowDays} days
        </Heading>
        <ul className="flex flex-col gap-1 text-xs" data-testid="top-spenders">
          {overview.topSpenders.length === 0 && <li className="text-slate">No AI usage in the window.</li>}
          {overview.topSpenders.map((account) => (
            <li key={account.userId} className="text-ink">
              {account.userId} — {account.requests} requests, {microUsd(account.microUsd)}
              {account.unpriced > 0 && (
                // Reported rather than folded in: a row nobody can price must
                // not silently contribute nothing to a total.
                <span className="ml-1 text-slate">({account.unpriced} unpriced)</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="grant-heading">
        <Heading level={2} id="grant-heading">
          Grant
        </Heading>
        {/* Only enabled plans are offered: `enabled` bounds what an operator
            may hand out, never what a holder may do, which is what lets the
            disabled fourth-plan proof ship without anyone receiving it. */}
        <GrantForm
          plans={overview.plans.filter((plan) => plan.live.enabled).map((plan) => plan.planId)}
        />
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="accounts-heading">
        <Heading level={2} id="accounts-heading">
          Accounts
        </Heading>
        <Table className="text-xs" data-testid="accounts-table">
          <THead>
            <TR>
              <TH>Account</TH>
              <TH>Holds</TH>
              <TH>Why</TH>
              <TH>Can</TH>
              <TH>Requests ({overview.windowDays}d)</TH>
              <TH>Cost ({overview.windowDays}d)</TH>
            </TR>
          </THead>
          <TBody>
            {overview.accounts.map((account) => (
              <TR key={account.userId} data-testid={`account-${account.userId}`}>
                <TD className="text-ink">
                  {account.email ?? account.userId}
                  {account.isAdmin && <span className="ml-1 text-slate">(admin)</span>}
                </TD>
                <TD className="text-ink">{account.planVersionRef}</TD>
                <TD className="text-ink">
                  {account.grantSources.length === 0 ? "—" : account.grantSources.join(", ")}
                </TD>
                <TD className="text-ink">
                  {account.entitlements.length === 0 ? "—" : account.entitlements.join(", ")}
                </TD>
                <TD className="text-ink">{account.requests}</TD>
                <TD className="text-ink">{microUsd(account.microUsd)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </section>
    </main>
  );
}
