"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import type { AdminAccountRow } from "@/lib/adminOverview";
import { cn } from "@/lib/cn";
import { ACCOUNT_FILTERS, accountsViewHref, type AccountFilter, type AccountsView } from "./accountsView";
import { microUsdCost, microUsdMoney } from "./microUsd";

// **The accounts table, as the design actually draws it** (handoff `SPEC.md`
// §18.2 — *"Address search, six counted filters, 8 rows a page, and a no-match
// state"*). Reported missing by Mitchell on the #174 preview: the first build
// rendered a bare 100-row table with none of it.
//
// **All six filters since M36 link 2.** M20 shipped four and renamed `Paying`
// to *Holds a paid plan*, because nothing paid yet and `Past due` and `Costs
// more than it pays` needed Stripe. M21 link 7 built the revenue half, the
// *Pays* column exists, and the label goes back (operator-console spec,
// § Accounts table).
//
// **Counts are over the SEARCH, not the page** — `f.count` in the design is
// `opsMatch(f.id, q)`, the whole matching set. A count that shrank as you
// paged would be answering a question nobody asked.
//
// **Search, filter and page live in the URL** (M36 D2) so the account page can
// hand them back. They are still filtering over the list the server already
// sent; only where they are kept changed.

const PAGE_SIZE = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Does this row match one filter?
 *
 * **`grantsNothing` is a set, and the first version of this was `planId ===
 * "free"`.** `planVersions.fourthPlan.test.ts` refused it — it walks every
 * source file for a comparison against a plan id and expects to find none,
 * which is ADR-045 rule 4 as a test. The rule is not pedantry: a fourth plan
 * that grants nothing would be silently missing from the *Free* count, and a
 * paid plan renamed would move accounts between groups with nothing failing.
 *
 * **`underwater` is the server's list, not a second opinion.** It is the
 * `paying` half of `underwaterReport` — the rows Financial counts — so *Show
 * them in Users* lands on the same accounts that panel counted.
 */
function matchesFilter(
  account: AdminAccountRow,
  filter: AccountFilter,
  grantsNothing: ReadonlySet<string>,
  underwater: ReadonlySet<string>,
): boolean {
  const planId = account.planVersionRef.split("@")[0] ?? "";
  switch (filter) {
    case "all":
      return true;
    case "paying":
      // **Pays = a subscription conferring its plan right now**, which is
      // `paysMicroUsd !== 0`. A `past_due` account inside its grace window
      // confers and so counts; holding a paid plan by grant is not paying.
      //
      // **Not always the strip's paying count, in two ways.** `null` — a
      // conferring subscription this deploy cannot price — counts here, because
      // the account does pay and the *Pays* column says `unpriced` rather than
      // hiding it; `revenueSummary` leaves it out of its paying accounts and
      // reports it as `unpricedSubscriptions`, because it cannot add an unknown
      // to MRR or divide MRR by it. And this counts the table's rows — the
      // newest 100 plus every underwater payer — where the strip counts every
      // account.
      return account.paysMicroUsd !== 0;
    case "granted":
      return account.grants.length > 0;
    case "unentitled":
      return grantsNothing.has(planId);
    case "pastDue":
      // Stripe's own word. Past the grace window it reads `lapsed` instead.
      return account.subscriptionState === "past_due";
    case "underwater":
      return underwater.has(account.userId);
  }
}

/** Address search, falling back to the id for an account with no address. */
function matchesQuery(account: AdminAccountRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return (
    (account.email ?? "").toLowerCase().includes(needle) ||
    account.userId.toLowerCase().includes(needle)
  );
}

/** The two words that are not a Stripe status: nothing, and lapsed. */
function stateLabel(account: AdminAccountRow): string {
  if (account.subscriptionState === null) return "—";
  return account.subscriptionState.replace(/_/g, " ");
}

/**
 * *Last active* as the artboard words it — `today`, `yesterday`, `9 days ago`,
 * `3 weeks ago`. Never older than the window (D6), so it needs no date form.
 * `now` comes from the server render, so server and browser draw the same word.
 */
function lastActiveLabel(at: string | null, now: string): string {
  if (at === null) return "—";
  const days = Math.floor((Date.parse(now) - Date.parse(at)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

/**
 * Whether a click on a row should open the account. Not when it landed on a
 * control in the row — the account's own link — and not when it came from
 * anything portalled out of the table in the DOM, whose clicks React still
 * bubbles up through this row. Not with a modifier held, which asks the
 * browser for something the row's `push` cannot give — the address link is
 * there for a new tab — and not when the click ended a text selection, which
 * is someone copying an address.
 */
function opensAccount(event: React.MouseEvent<HTMLTableRowElement>): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return false;
  if ((window.getSelection()?.toString() ?? "") !== "") return false;
  const target = event.target as Element;
  if (!event.currentTarget.contains(target)) return false;
  return target.closest("a, button, input, select, textarea, label") === null;
}

type AccountsPanelProps = {
  accounts: readonly AdminAccountRow[];
  /** Plan ids whose live version grants no entitlement. See `matchesFilter`. */
  plansGrantingNothing: readonly string[];
  /** Paying accounts the underwater report lists. See `matchesFilter`. */
  underwater: readonly string[];
  /** The view the URL arrived with (D2). */
  initial: AccountsView;
  /** ISO, from the server render — what *Last active* is measured against. */
  now: string;
  windowDays: number;
};

/**
 * The Users tab's accounts table: search, six counted filters, eight rows a
 * page, each row opening its account page with the view kept in the URL.
 *
 * **Keyed on the view it arrived with**, so a navigation that brings a
 * different one — Back or Forward to another filter — remounts the table and
 * re-seeds it. The state below is seeded once and only ever flows out to the
 * URL; without the key, Back changed the address bar and left the table where
 * it was.
 */
export function AccountsPanel(props: AccountsPanelProps) {
  return <AccountsTable key={accountsViewHref(props.initial)} {...props} />;
}

function AccountsTable({
  accounts,
  plansGrantingNothing,
  underwater,
  initial,
  now,
  windowDays,
}: AccountsPanelProps) {
  const router = useRouter();
  const grantsNothing = useMemo(() => new Set(plansGrantingNothing), [plansGrantingNothing]);
  const underwaterIds = useMemo(() => new Set(underwater), [underwater]);
  const [query, setQuery] = useState(initial.query);
  const [filter, setFilter] = useState<AccountFilter>(initial.filter);
  const [page, setPage] = useState(initial.page);

  const searched = useMemo(
    () => accounts.filter((account) => matchesQuery(account, query)),
    [accounts, query],
  );
  const matching = useMemo(
    () => searched.filter((account) => matchesFilter(account, filter, grantsNothing, underwaterIds)),
    [searched, filter, grantsNothing, underwaterIds],
  );

  // Clamped rather than reset on every change: a filter that empties the last
  // page should land on the last page that has rows, not silently on page one
  // while the range line says otherwise.
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = matching.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const view: AccountsView = { query, filter, page: current };

  // **State → URL, one direction**, as `DiscoverScreen` does it: the input
  // keeps its own state so typing never waits on a navigation, and
  // `history.replaceState` rather than `router.replace` because Next syncs the
  // native history API into its router while a router navigation would re-run
  // this page's server component — the whole overview, Stripe's price sweep
  // included — once per keystroke. Replace, not push: a filter is not a place
  // Back should stop. Skipped on the first render, which the URL seeded.
  const seeded = useRef(true);
  const href = accountsViewHref(view);
  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    window.history.replaceState(window.history.state, "", href);
  }, [href]);

  function reset() {
    setQuery("");
    setFilter("all");
    setPage(0);
  }

  return (
    <div className="flex flex-col gap-3">
      <Text variant="secondary" className="text-xs">
        Plan and version are what the account holds. Cost is model tokens over the trailing{" "}
        {windowDays} days, priced at the rates in force on each day.
      </Text>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-60"
          aria-label="Find an account"
          placeholder="Find an address…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
        <div className="flex flex-wrap gap-1.5">
          {ACCOUNT_FILTERS.map((option) => (
            <Button
              key={option.id}
              type="button"
              // **`md`, not `sm`** — Mitchell: *"These tabs should be the same
              // size as the Find an address input"*. `Input` is `h-9` and
              // `size="sm"` is `h-7`, so the row read as two different kinds of
              // control on one line. Taking the size from the same scale rather
              // than writing a height keeps them matched if the scale moves.
              size="md"
              // Pills, as the design draws them.
              className="rounded-full text-sm"
              variant={option.id === filter ? "secondary" : "ghost"}
              aria-pressed={option.id === filter}
              onClick={() => {
                setFilter(option.id);
                setPage(0);
              }}
            >
              {option.label}
              <span className="ml-1.5 text-xs text-slate">
                {
                  searched.filter((account) =>
                    matchesFilter(account, option.id, grantsNothing, underwaterIds),
                  ).length
                }
              </span>
            </Button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No account matches"
          body={
            query.trim() === ""
              ? "No account is in this group yet."
              : `No address matches “${query.trim()}” in this group.`
          }
          action={
            <Button type="button" variant="secondary" size="sm" onClick={reset}>
              Clear the filter
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-xs" data-testid="accounts-table">
            <THead>
              <TR>
                <TH>Account</TH>
                <TH>Holds</TH>
                <TH>Why</TH>
                <TH>Pays</TH>
                <TH>Costs {windowDays}d</TH>
                <TH>Asked {windowDays}d</TH>
                <TH>Last active</TH>
                <TH>State</TH>
                <TH>
                  <span className="sr-only">Open</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((account) => {
                const open = accountsViewHref(view, account.userId);
                const sinking = underwaterIds.has(account.userId);
                return (
                  <TR
                    key={account.userId}
                    data-testid={`account-${account.userId}`}
                    // **The whole row opens the account page** (M36 link 2), with
                    // the view kept so its *← All accounts* comes back here. The
                    // address is also a real link, for the keyboard and for a
                    // middle-click; the row's click is the pointer's shortcut.
                    // Underwater rows keep their tint until hovered, as drawn.
                    className={cn("cursor-pointer hover:bg-moss", sinking && "bg-danger-tint")}
                    onClick={(event) => {
                      if (opensAccount(event)) router.push(open);
                    }}
                  >
                    <TD className="text-ink">
                      <Link href={open}>{account.email ?? account.userId}</Link>
                      {account.isAdmin && <span className="ml-1 text-slate">(admin)</span>}
                    </TD>
                    <TD className="text-ink">{account.planVersionRef}</TD>
                    <TD className="text-ink">
                      {/* Why they hold it: every active grant's source. Granting
                          and revoking are the account page's (M36 link 3) — a
                          write with a confirm needs more room than a cell. */}
                      {account.grantSources.length === 0 ? (
                        <span className="text-slate">—</span>
                      ) : (
                        account.grantSources.join(" · ")
                      )}
                    </TD>
                    <TD className="text-ink">
                      {account.paysMicroUsd === null
                        ? "unpriced"
                        : account.paysMicroUsd === 0
                          ? "—"
                          : microUsdMoney(account.paysMicroUsd)}
                    </TD>
                    <TD className={sinking ? "text-danger-ink" : "text-ink"}>
                      {microUsdCost(account.microUsd)}
                      {account.unpriced > 0 && (
                        // **A cost with unpriceable rows behind it is not the
                        // cost.** An account whose every request used a model
                        // with no published rate rendered a confident `$0.0000`.
                        // Reported rather than folded in, the same way the ledger
                        // itself refuses to price an unmeasurable row. CodeRabbit,
                        // PR #174.
                        <span className="ml-1 text-slate">({account.unpriced} unpriced)</span>
                      )}
                    </TD>
                    <TD className="text-ink">
                      {account.requests === 0 ? "—" : account.requests.toLocaleString("en-US")}
                    </TD>
                    <TD className="text-slate">{lastActiveLabel(account.lastActiveAt, now)}</TD>
                    <TD className="text-ink">
                      <div className="flex flex-wrap items-center gap-1">
                        <span>{stateLabel(account)}</span>
                        {/* The design's two chips. `Past due` is a warning
                            because nothing has been taken yet — the grace window
                            is still running — and `Costs more than it pays` is
                            the one that wants an answer. */}
                        {account.subscriptionState === "past_due" ? (
                          <Badge variant="warning">Past due</Badge>
                        ) : null}
                        {sinking ? <Badge variant="danger">Costs more than it pays</Badge> : null}
                      </div>
                    </TD>
                    <TD className="text-right text-slate">
                      <span aria-hidden="true">›</span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2">
        <Text as="span" variant="secondary" className="text-xs" data-testid="accounts-range">
          {matching.length === 0
            ? "No accounts"
            : `${current * PAGE_SIZE + 1}–${current * PAGE_SIZE + rows.length} of ${matching.length}`}
        </Text>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
