"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import { GrantDialog } from "@/components/admin/GrantDialog";
import { GrantList } from "@/components/admin/GrantList";
import type { AdminAccountRow } from "@/lib/adminOverview";

// **The accounts table, as the design actually draws it** (handoff `SPEC.md`
// §18.2 — *"Address search, six counted filters, 8 rows a page, and a no-match
// state"*). Reported missing by Mitchell on the #174 preview: the first build
// rendered a bare 100-row table with none of it.
//
// **Four of the six filters, and the two that are absent are the point.** The
// design's set is All / Paying / Granted / Free / Past due / Costs more than it
// pays. `Past due` is a subscription state and `Costs more than it pays` is a
// comparison against revenue — **both need Stripe, so both are M21 link 7's**,
// exactly like the four-number strip this console deliberately does not have.
// The temptation is to ship them against `microUsd` alone, and that is the
// split failing in the direction M20's link 7 warns about at length: an
// implementer working from the finished screen builds the revenue half inside
// M20. There is no honest M20 answer to "costs more than it pays" because
// nothing pays yet.
//
// `Paying` is renamed **Holds a paid plan** for the same reason. In M20 an
// account holds `premium` because an operator granted it, and nobody has paid
// anything; a chip reading "Paying" over a table of comped accounts would be a
// false number of exactly the kind the split exists to prevent.
//
// **Counts are over the SEARCH, not the page** — `f.count` in the design is
// `opsMatch(f.id, '')`, the whole matching set. A count that shrank as you
// paged would be answering a question nobody asked.

const PAGE_SIZE = 8;

type FilterId = "all" | "paid" | "granted" | "free";

const FILTERS: readonly { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "paid", label: "Holds a paid plan" },
  { id: "granted", label: "Granted" },
  { id: "free", label: "Free" },
];

/**
 * Does this row match one filter?
 *
 * Asked as *"does the held plan grant anything"* would be better, but the row
 * carries `planVersionRef` rather than the plan's entitlements, and the free
 * plan is the one whose id the wire shape does expose. The comparison is
 * against the REF's plan segment rather than a rank — there is no ordering
 * here, and ADR-045 rule 4 forbids inventing one.
 */
function matchesFilter(account: AdminAccountRow, filter: FilterId): boolean {
  const planId = account.planVersionRef.split("@")[0];
  switch (filter) {
    case "all":
      return true;
    case "free":
      return planId === "free";
    case "paid":
      return planId !== "free";
    case "granted":
      return account.grants.length > 0;
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

function microUsd(value: number): string {
  return `$${(value / 1_000_000).toFixed(4)}`;
}

export function AccountsPanel({
  accounts,
  plans,
  windowDays,
}: {
  accounts: readonly AdminAccountRow[];
  plans: readonly string[];
  windowDays: number;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [page, setPage] = useState(0);

  const searched = useMemo(
    () => accounts.filter((account) => matchesQuery(account, query)),
    [accounts, query],
  );
  const matching = useMemo(
    () => searched.filter((account) => matchesFilter(account, filter)),
    [searched, filter],
  );

  // Clamped rather than reset on every change: a filter that empties the last
  // page should land on the last page that has rows, not silently on page one
  // while the range line says otherwise.
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = matching.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

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
          {FILTERS.map((option) => (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={option.id === filter ? "secondary" : "ghost"}
              aria-pressed={option.id === filter}
              onClick={() => {
                setFilter(option.id);
                setPage(0);
              }}
            >
              {option.label}
              <span className="ml-1.5 text-xs text-slate">
                {searched.filter((account) => matchesFilter(account, option.id)).length}
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
                <TH>Can</TH>
                <TH>Requests ({windowDays}d)</TH>
                <TH>Cost ({windowDays}d)</TH>
                <TH>Grant</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((account) => (
                <TR key={account.userId} data-testid={`account-${account.userId}`}>
                  <TD className="text-ink">
                    {account.email ?? account.userId}
                    {account.isAdmin && <span className="ml-1 text-slate">(admin)</span>}
                  </TD>
                  <TD className="text-ink">{account.planVersionRef}</TD>
                  <TD className="text-ink">
                    {/* Link 7's grant history, and the console's second write.
                        Revoking marks the row rather than removing it — the row
                        is what answers "has this account ever held a trial". */}
                    <GrantList grants={account.grants} />
                  </TD>
                  <TD className="text-ink">
                    {account.entitlements.length === 0 ? "—" : account.entitlements.join(", ")}
                  </TD>
                  <TD className="text-ink">{account.requests}</TD>
                  <TD className="text-ink">{microUsd(account.microUsd)}</TD>
                  <TD className="text-ink">
                    <GrantDialog userId={account.userId} plans={plans} />
                  </TD>
                </TR>
              ))}
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
