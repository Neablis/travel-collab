"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import type { AdminAccountRow, AdminAccountsPage } from "@/lib/adminOverview";
import { cn } from "@/lib/cn";
import { ACCOUNT_FILTERS, accountsViewHref, type AccountsView } from "./accountsView";
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
// **The server searches, counts and pages; this draws one page** (M36 perf
// pass). It used to be handed the newest 100 accounts plus every underwater
// payer, each through the resolver — 310 queries a load — and filter over
// them here, so an account older than the newest 100 could not be found at
// all. What a filter means now lives in one place, `accountsMatching` in
// `server/entitlements/admin.ts`, and its counts are over the whole search,
// not the page — `f.count` in the design is `opsMatch(f.id, q)`.
//
// **Search, filter and page are the URL** (M36 D2), so the account page can
// hand them back and every change is a navigation to the next view. A filter
// or a page is one click and navigates at once; typing navigates once the
// operator pauses (`SEARCH_PAUSE_MS`), so a keystroke is never a round trip
// and the box never waits on one.

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long typing must pause before the search is sent — a word, not a letter. */
export const SEARCH_PAUSE_MS = 300;

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
  /** One page of the table, read by the server for `view`. */
  table: AdminAccountsPage;
  /** The view the URL carries (D2). Its page is the one asked for; `table.page` is the one served. */
  view: AccountsView;
  /** ISO, from the server render — what *Last active* is measured against. */
  now: string;
  windowDays: number;
};

/**
 * The Users tab's accounts table: search, six counted filters, eight rows a
 * page, each row opening its account page with the view kept in the URL.
 *
 * **Filter and page are read straight off `view`**, so Back or Forward to
 * another view redraws the table with nothing to re-seed. The search box is
 * the one piece of local state — typing must not wait on the server — and it
 * follows the URL whenever the URL's search moves under it, except while the
 * operator has typed past what was last sent: that newer text is on its way.
 */
export function AccountsPanel({ table, view, now, windowDays }: AccountsPanelProps) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [query, setQuery] = useState(view.query);
  // The search the URL carries or this box last sent, whichever came later.
  const [sent, setSent] = useState(view.query);
  const [seen, setSeen] = useState(view.query);
  if (view.query !== seen) {
    setSeen(view.query);
    setSent(view.query);
    if (query === sent) setQuery(view.query);
  }

  /**
   * Go to another view. **Replace, not push**, as when the view was written
   * with `history.replaceState`: a filter is not a place Back should stop.
   * In a transition, so the page on screen stays until the next one is read.
   */
  function show(next: AccountsView) {
    setSent(next.query);
    startNavigation(() => router.replace(accountsViewHref(next), { scroll: false }));
  }

  useEffect(() => {
    if (query === sent) return;
    const timer = setTimeout(() => {
      setSent(query);
      startNavigation(() =>
        router.replace(accountsViewHref({ query, filter: view.filter, page: 0 }), { scroll: false }),
      );
    }, SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query, sent, view.filter, router]);

  const { rows, counts, page, pageSize } = table;
  const matching = counts[view.filter];
  const pageCount = Math.max(1, Math.ceil(matching / pageSize));
  // The rows' links carry the view that was SERVED, so *← All accounts* comes
  // back to the page the operator was looking at.
  const served: AccountsView = { ...view, page };

  // **The address bar says what the table drew** (M36 part 3 review). The
  // server clamps a page past the end and drops a filter it does not know, so
  // `?page=9` over two pages draws page 2; the URL is corrected to match, with
  // `replaceState` because the table already shows that view — there is
  // nothing for a navigation to read.
  const servedHref = accountsViewHref(served);
  useEffect(() => {
    if (servedHref === window.location.pathname + window.location.search) return;
    window.history.replaceState(window.history.state, "", servedHref);
  }, [servedHref]);
  const underwaterIds = new Set(table.underwater);

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
          onChange={(event) => setQuery(event.target.value)}
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
              variant={option.id === view.filter ? "secondary" : "ghost"}
              aria-pressed={option.id === view.filter}
              // The box's text, sent or not: a filter picked mid-word filters
              // what the operator can see they typed.
              onClick={() => show({ query, filter: option.id, page: 0 })}
            >
              {option.label}
              <span className="ml-1.5 text-xs text-slate">{counts[option.id]}</span>
            </Button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No account matches"
          body={
            view.query.trim() === ""
              ? "No account is in this group yet."
              : `No address matches “${view.query.trim()}” in this group.`
          }
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setQuery("");
                show({ query: "", filter: "all", page: 0 });
              }}
            >
              Clear the filter
            </Button>
          }
        />
      ) : (
        <div className={cn("overflow-x-auto", navigating && "opacity-60")} aria-busy={navigating}>
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
                const open = accountsViewHref(served, account.userId);
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
          {matching === 0
            ? "No accounts"
            : `${page * pageSize + 1}–${page * pageSize + rows.length} of ${matching}`}
        </Text>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page === 0}
            onClick={() => show({ ...served, page: page - 1 })}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page >= pageCount - 1}
            onClick={() => show({ ...served, page: page + 1 })}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
