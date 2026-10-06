import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import type { AdminAccountDetail, AdminAccountState, AdminAccountTurn } from "@/lib/adminAccount";
import { cn } from "@/lib/cn";
import { AccountGrants } from "./AccountGrants";
import {
  CONTEXT_DANGER_TOKENS,
  ceilingRule,
  dayLabel,
  daysAgo,
  seconds,
  shortDate,
  spokenRef,
  tokens,
} from "./accountFormat";
import { GrantDialog } from "./GrantDialog";
import { microUsdCost, microUsdMoney } from "./microUsd";

// **One account's page** (M36 link 3, operator-console spec § *Account page*).
// `/admin?tab=users&account=<id>` renders this in place of the accounts table
// (D1); *← All accounts* goes back to the table's own URL, filter and page kept.
//
// **What it does not draw, on purpose.**
//   * No question, answer or trip from the ledger, and no affordance to see
//     one (D7). The ledger holds none; the footer says so in the spec's words.
//   * No *shared* or *started N trips* under Notebooks (D5): neither has a
//     source until a notebook share link exists.
//
// A server component apart from its two writes — `GrantDialog` and the grant
// cards — which are client components because they hold dialog and confirm
// state and call `/api/admin/grants`.

const STATE: Record<AdminAccountState, { label: string; variant: "success" | "info" | "warning" | "neutral" }> = {
  active: { label: "active", variant: "success" },
  granted: { label: "granted", variant: "info" },
  pastDue: { label: "past due", variant: "warning" },
  none: { label: "free", variant: "neutral" },
};

const OUTCOME: Record<AdminAccountTurn["outcome"], string> = {
  answered: "answered",
  proposed: "proposed",
  failed: "failed",
  stopped: "stopped",
};

/** The section labels the spec draws: 11px/600, tracked, uppercase, slate. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs font-semibold tracking-wide text-slate uppercase">{children}</span>;
}

/** *← All accounts*, back to the table with its view kept. */
function BackToAccounts({ href }: { href: string }) {
  return (
    <div className="flex">
      <Link href={href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        ← All accounts
      </Link>
    </div>
  );
}

/**
 * `?account=` naming nobody. Not a 404: the operator is authorised and the
 * page exists — the id is what is wrong, most likely a stale link.
 */
export function NoSuchAccount({ back }: { back: string }) {
  return (
    <div className="flex flex-col gap-4">
      <BackToAccounts href={back} />
      <EmptyState title="No such account" body="Nothing on this deployment has that id. The link may be stale." />
    </div>
  );
}

/** The account page: header, facts, assistant, activity, plan and grants. */
export function AccountPage({
  detail,
  plans,
  back,
  now,
}: {
  detail: AdminAccountDetail;
  /** Plan ids an operator may grant — enabled plans only. */
  plans: readonly string[];
  /** The accounts table's URL, view kept. */
  back: string;
  /** ISO, from the server render. */
  now: string;
}) {
  const { plan, activity, windowDays } = detail;
  const account = plan.account;
  const address = account.email ?? account.userId;
  const state = STATE[plan.state];

  const pays =
    account.paysMicroUsd === null
      ? { value: "unpriced", sub: "a month" }
      : account.paysMicroUsd > 0
        ? { value: microUsdMoney(account.paysMicroUsd), sub: "a month" }
        : { value: "—", sub: account.grants.length > 0 ? "comped" : "nothing" };

  const facts: { label: string; value: string; sub: string; danger?: boolean }[] = [
    { label: "Joined", value: shortDate(plan.joinedAt), sub: `${daysAgo(plan.joinedAt, now)} days ago` },
    {
      label: "Last active",
      value: account.lastActiveAt === null ? "—" : dayLabel(account.lastActiveAt, now),
      sub: `active ${detail.activeDays} of ${windowDays} days`,
    },
    {
      label: "Trips",
      value: String(detail.trips.owned + detail.trips.invitedTo),
      sub: `${detail.trips.owned} own · ${detail.trips.invitedTo} invited to`,
    },
    { label: "Notebooks", value: String(detail.notebooks), sub: "saved" },
    { label: "Pays", value: pays.value, sub: pays.sub },
    {
      label: `Costs ${windowDays}d`,
      value: microUsdCost(account.microUsd),
      sub: account.unpriced > 0 ? `${account.unpriced} unpriced` : "model tokens",
      danger: plan.underwater,
    },
  ];

  return (
    <div className="flex flex-col gap-4.5" data-testid="account-page">
      <BackToAccounts href={back} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-2xl font-semibold tracking-tight text-ink break-all">{address}</span>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="neutral">{spokenRef(account.planVersionRef)}</Badge>
            <Badge variant={state.variant}>{state.label}</Badge>
            {plan.underwater && <Badge variant="danger">Costs more than it pays</Badge>}
          </div>
        </div>
        <GrantDialog userId={account.userId} plans={plans} />
      </div>

      <dl
        aria-label="Facts"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline md:grid-cols-3 xl:grid-cols-6"
      >
        {facts.map((fact) => (
          <div key={fact.label} className="flex flex-col gap-1.5 bg-surface px-4 py-3.5">
            <dt className="text-xs text-slate">{fact.label}</dt>
            <dd className="flex flex-col gap-1.5">
              <DataText size="base" className={cn("font-semibold", fact.danger ? "text-danger-ink" : "text-ink")}>
                {fact.value}
              </DataText>
              <span className="text-xs text-slate">{fact.sub}</span>
            </dd>
          </div>
        ))}
      </dl>

      <Panel title={`Assistant · last ${windowDays} days`} aria-label={`Assistant · last ${windowDays} days`}>
        <AssistantSection detail={detail} now={now} />
      </Panel>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <Panel title="Activity">
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <div
                role="img"
                aria-label={`Edits a day over ${windowDays} days, ${activity.editsPerDay.reduce((a, b) => a + b, 0)} in all`}
                className="flex h-9 items-end gap-0.5 border-b border-hairline"
              >
                {activity.editsPerDay.map((count, day) => {
                  const peak = Math.max(1, ...activity.editsPerDay);
                  return (
                    <div
                      key={day}
                      title={`${count} edits`}
                      className="min-w-0 flex-1 rounded-xs bg-slate"
                      // eslint-disable-next-line no-restricted-syntax -- a bar's height is its day's count over the peak, computed data with no token equivalent
                      style={{ height: count === 0 ? 0 : `${Math.max(8, (count / peak) * 100)}%` }}
                    />
                  );
                })}
              </div>
              <DataText size="xs">Edits a day</DataText>
            </div>
            {activity.recent.length === 0 ? (
              <Text variant="secondary" className="text-sm">
                No planning edits yet.
              </Text>
            ) : (
              <ol aria-label="Recent activity" className="flex flex-col">
                {activity.recent.map((event, index) => (
                  <li key={`${event.at}-${index}`} className="flex items-baseline gap-2.5 border-t border-hairline py-1.5">
                    <span className="w-18 shrink-0 font-mono text-xs text-slate">{dayLabel(event.at, now)}</span>
                    <span className="text-sm text-ink">{event.what}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Panel>

        <Panel title="Plan and grants">
          <AccountGrants
            grants={plan.grants}
            history={plan.history}
            fallsBackTo={plan.fallsBackTo}
            account={address}
            now={now}
          />
        </Panel>
      </div>
    </div>
  );
}

/** *Assistant · last 30 days*: stats, questions a day, top tools, recent turns. */
function AssistantSection({ detail, now }: { detail: AdminAccountDetail; now: string }) {
  const { assistant, windowDays } = detail;

  if (assistant.questions === 0) {
    // **Decided from the live entitlements, never the plan id** (ADR-045 rule
    // 4) — `offered` is the resolver's set, so a grant of a plan with the
    // assistant on a plan without one reads as offered.
    return assistant.offered ? (
      <EmptyState
        title="Hasn’t asked anything in 30 days"
        body="They hold a plan with the assistant and haven’t used it. Nothing is wrong — this is just quiet."
      />
    ) : (
      <EmptyState
        title="No assistant on this plan"
        body="Nothing they hold grants an ai.* entitlement, so there is nothing to show. A grant of a plan with the assistant applies on their next request."
      />
    );
  }

  const stats: { label: string; value: string; danger?: boolean }[] = [
    { label: "questions asked", value: assistant.questions.toLocaleString("en-US") },
    {
      label: `steps · ${(assistant.steps / assistant.questions).toFixed(1)} a question`,
      value: assistant.steps.toLocaleString("en-US"),
    },
    { label: "tool calls a turn, median", value: String(assistant.medianToolCalls ?? 0) },
    {
      label: "context per step, median · p95",
      value:
        assistant.contextMedian === null || assistant.contextP95 === null
          ? "—"
          : `${tokens(assistant.contextMedian)} · ${tokens(assistant.contextP95)}`,
      danger: (assistant.contextP95 ?? 0) > CONTEXT_DANGER_TOKENS,
    },
    { label: "failed turns", value: String(assistant.failed) },
  ];

  return (
    <div className="flex flex-col gap-4.5">
      <dl className="grid grid-cols-2 gap-3.5 md:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1">
            <dd>
              <DataText size="base" className={cn("font-semibold", stat.danger ? "text-danger-ink" : "text-ink")}>
                {stat.value}
              </DataText>
            </dd>
            <dt className="text-xs text-slate">{stat.label}</dt>
          </div>
        ))}
      </dl>

      <QuestionsADay perDay={assistant.perDay} ceiling={assistant.requestsPerDay} windowDays={windowDays} now={now} />

      {assistant.topTools.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Tools it called most</SectionLabel>
          <ul className="flex flex-wrap gap-1.5">
            {assistant.topTools.map((tool) => (
              <li
                key={tool.tool}
                className="inline-flex items-baseline gap-1.5 rounded-sm border border-hairline px-2 py-1 font-mono text-xs text-ink"
              >
                {tool.tool}
                <span className="text-slate">{tool.calls.toLocaleString("en-US")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>Recent turns</SectionLabel>
        <div className="overflow-x-auto">
          <Table className="text-xs" aria-label="Recent turns">
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Kind</TH>
                <TH>Model</TH>
                <TH className="text-right">Steps</TH>
                <TH className="text-right">Tool calls</TH>
                <TH className="text-right">Peak context</TH>
                <TH className="text-right">Took</TH>
                <TH>Outcome</TH>
              </TR>
            </THead>
            <TBody>
              {assistant.recent.map((turn, index) => (
                <TR key={`${turn.at}-${index}`}>
                  <TD className="font-mono whitespace-nowrap text-ink">{dayLabel(turn.at, now)}</TD>
                  <TD className="text-ink">{turn.kind}</TD>
                  <TD className="font-mono whitespace-nowrap text-slate">{turn.model}</TD>
                  <TD className="text-right font-mono text-ink">{turn.steps}</TD>
                  <TD className="text-right font-mono text-ink">{turn.toolCalls}</TD>
                  <TD
                    className={cn(
                      "text-right font-mono",
                      (turn.peakContext ?? 0) > CONTEXT_DANGER_TOKENS ? "text-danger-ink" : "text-ink",
                    )}
                  >
                    {turn.peakContext === null ? "—" : tokens(turn.peakContext)}
                  </TD>
                  <TD className="text-right font-mono text-ink">
                    {turn.latencyMs === null ? "—" : seconds(turn.latencyMs)}
                  </TD>
                  <TD>
                    <Badge variant={turn.outcome === "failed" ? "danger" : "neutral"}>{OUTCOME[turn.outcome]}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <Text variant="secondary" className="text-xs">
          The ledger keeps counts and sizes, never the question or the trip — so this shows what a turn cost, not what
          was asked.
        </Text>
      </div>
    </div>
  );
}

/**
 * Thirty bars against the plan's daily ceiling — `ceilingRule` decides the
 * scale, whether the ceiling draws, and which bars are at it.
 */
function QuestionsADay({
  perDay,
  ceiling,
  windowDays,
  now,
}: {
  perDay: readonly number[];
  ceiling: number | null;
  windowDays: number;
  now: string;
}) {
  const rule = ceilingRule(perDay, ceiling);
  const label =
    rule.mode === "near"
      ? `dashed line = ${rule.ceiling} a day ceiling · hit on ${rule.daysAtCeiling} days`
      : rule.mode === "far"
        ? `ceiling ${rule.ceiling} a day — well above this`
        : rule.mode === "none"
          ? "ceiling 0 a day — what they hold now allows no questions"
          : "no daily ceiling of its own — the deployment default applies";
  const from = new Date(Date.parse(now) - (windowDays - 1) * 24 * 60 * 60 * 1000).toISOString();

  return (
    <div className="flex flex-col gap-1.5" data-testid="questions-a-day">
      <div className="flex justify-between gap-2.5 text-xs text-slate">
        <span>Questions a day</span>
        <DataText size="xs">{label}</DataText>
      </div>
      <div className="relative h-24 border-b border-hairline">
        {rule.mode === "near" && (
          <div
            aria-hidden="true"
            data-testid="ceiling-line"
            className="absolute inset-x-0 border-t border-dashed border-danger-ink"
            // eslint-disable-next-line no-restricted-syntax -- the ceiling's offset is the ceiling over the chart's scale, computed geometry
            style={{ bottom: `${(rule.ceiling / rule.scale) * 100}%` }}
          />
        )}
        <div
          role="img"
          aria-label={`Questions a day over ${windowDays} days, peak ${Math.max(0, ...perDay)}`}
          className="absolute inset-0 flex items-end gap-0.5"
        >
          {perDay.map((count, day) => {
            const atCeiling = rule.mode === "near" && count >= rule.ceiling;
            return (
              <div
                key={day}
                title={`${count} questions${atCeiling ? " · at the ceiling" : ""}`}
                data-at-ceiling={atCeiling || undefined}
                className={cn("min-w-0 flex-1 rounded-t-xs", atCeiling ? "bg-danger-ink" : "bg-ink")}
                // eslint-disable-next-line no-restricted-syntax -- a bar's height is its day's count over the chart's scale, computed data with no token equivalent
                style={{
                  height: count === 0 ? 0 : `${Math.max(3, (Math.min(count, rule.scale) / rule.scale) * 100)}%`,
                }}
              />
            );
          })}
        </div>
      </div>
      <div className="flex justify-between">
        <DataText size="xs">{shortDate(from)}</DataText>
        <DataText size="xs">today</DataText>
      </div>
    </div>
  );
}
