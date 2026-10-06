"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import { GrantDialog } from "@/components/admin/GrantDialog";
import { GrantList } from "@/components/admin/GrantList";
import type { AdminAccountRow } from "@/lib/adminOverview";
import { cn } from "@/lib/cn";
import {
  ACCOUNT_FILTERS,
  accountsViewHref,
  resolveAccountsView,
  type AccountFilter,
  type AccountsView,
} from "./accountsView";
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
 * control in the row — Grant, Revoke, the account's own link — and not when it
 * came from the grant dialog: that is portalled out of the table in the DOM,
 * but React still bubbles its clicks up through this row. Not with a modifier
 * held, which asks the browser for something the row's `push` cannot give —
 * the address link is there for a new tab — and not when the click ended a
 * text selection, which is someone copying an address.
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
  /** Plan ids an operator may grant — enabled plans only. */
  plans: readonly string[];
  /** Plan ids whose live version grants no entitlement. See `matchesFilter`. */
  plansGrantingNothing: readonly string[];
  /** Paying accounts the underwater report lists. See `matchesFilter`. */
  underwater: readonly string[];
  /** ISO, from the server render — what *Last active* is measured against. */
  now: string;
  windowDays: number;
};

/** The view a query string holds, normalised as the table would write it. */
function viewIn(params: URLSearchParams): AccountsView {
  return resolveAccountsView(Object.fromEntries(params));
}

/**
 * The Users tab's accounts table: search, six counted filters, eight rows a
 * page, each row opening its account page with the view kept in the URL.
 *
 * **The view is read from `useSearchParams`, not from the server render.** It
 * was a server-passed `initial`, and Next's `history.replaceState` changes the
 * URL while a history entry keeps the tree it was first rendered with — so
 * Back to an entry whose filter the table had rewritten remounted it on the
 * entry's original view (M36 part 3 review). `useSearchParams` is what Next
 * keeps in step with `replaceState` and with Back and Forward, and on the
 * server it is the request's own, so the first paint needs nothing else.
 *
 * **Seeded once, then re-seeded only by a navigation** — a URL that differs
 * from the table's own view and is where the browser actually is. The second
 * half is what tells Back from this table's own write arriving a render late:
 * typing moves the URL every keystroke, and re-seeding from a write the input
 * has since typed past would put the old text back.
 */
export function AccountsPanel({
  accounts,
  plans,
  plansGrantingNothing,
  underwater,
  now,
  windowDays,
}: AccountsPanelProps) {
  const router = useRouter();
  const arrived = viewIn(useSearchParams());
  const grantsNothing = useMemo(() => new Set(plansGrantingNothing), [plansGrantingNothing]);
  const underwaterIds = useMemo(() => new Set(underwater), [underwater]);
  const [query, setQuery] = useState(arrived.query);
  const [filter, setFilter] = useState<AccountFilter>(arrived.filter);
  const [page, setPage] = useState(arrived.page);

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
  // Back should stop. Only when the URL says something else — which on the
  // first render is a view the table corrected, a page past the end or a
  // filter it does not know, and is written back so the address bar and the
  // row links agree with the table.
  const href = accountsViewHref(view);
  useEffect(() => {
    if (href === window.location.pathname + window.location.search) return;
    window.history.replaceState(window.history.state, "", href);
  }, [href]);

  // **URL → state, on a navigation only.** After the write above, never before
  // it: when both move in one render, the write has put the browser where the
  // table is, and the URL this render read is the one being left.
  const arrivedHref = accountsViewHref(arrived);
  useEffect(() => {
    if (arrivedHref === href) return;
    if (arrivedHref !== accountsViewHref(viewIn(new URLSearchParams(window.location.search)))) return;
    setQuery(arrived.query);
    setFilter(arrived.filter);
    setPage(arrived.page);
    // Keyed on the URL alone: a change of `href` is this table's own doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedHref]);

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
                      {/* Link 7's grant history, and the console's second write.
                          Revoking marks the row rather than removing it — the row
                          is what answers "has this account ever held a trial".
                          It moves to the account page with M36 link 3; until
                          then it stays, or this preview could not revoke. */}
                      <GrantList grants={account.grants} />
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
                    <TD className="text-slate">
                      <div className="flex items-center justify-end gap-2">
                        {/* Grant leaves the row for the account page with M36
                            link 3; it stays until that page exists to hold it. */}
                        <GrantDialog userId={account.userId} plans={plans} />
                        <span aria-hidden="true">›</span>
                      </div>
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
