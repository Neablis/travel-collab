"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TBody, THead, TH, TD, TR, Table } from "@/components/ui/table";
import type { AdminUnderwaterView } from "@/lib/adminOverview";
import { microUsdCost, microUsdMargin, microUsdMoney } from "./microUsd";

// **"Costs more than it pays", segmented by WHY** — M21 link 7's hardest
// requirement, and it is a requirement about the LAYOUT and not only about the
// query:
//
// > *"one count for paying-and-underwater with a button that filters the table,
// > and grant-funded accounts counted by source and set aside."*
//
// The reason is the one the milestone gives and it is worth restating where the
// screen is built: **an account on a founder, trial, referral or admin grant is
// underwater by construction.** That is a decision already taken, not a
// finding. Unsegmented, those accounts dominate the list and the metric is
// worthless — and on this deployment every account predating M20's migration
// holds a permanent founder grant, so "dominate" is not a hypothetical.
//
// So the two halves are not two filters over one table. The paying half is a
// list of rows that each need a decision; the granted half is a **count per
// source**, set aside and deliberately not enumerated, because enumerating it
// invites reading it as the same kind of finding.

export function UnderwaterPanel({ report }: { report: AdminUnderwaterView }) {
  const [showing, setShowing] = useState(false);

  return (
    <div className="flex flex-col gap-3" data-testid="underwater-panel">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-0.5">
          <Text as="span" className="text-xs uppercase tracking-wider text-slate">
            Paying and underwater
          </Text>
          <Text as="span" className="text-xl font-semibold text-ink" data-testid="underwater-paying-count">
            {report.paying.length}
          </Text>
          <Text variant="secondary" className="text-xs">
            Accounts whose trailing {report.windowDays}-day cost exceeds what they send. These are
            the rows that need a decision.
          </Text>
        </div>
        {report.paying.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowing((open) => !open)}
            data-testid="underwater-toggle"
          >
            {showing ? "Hide them" : "Show them"}
          </Button>
        ) : null}
      </div>

      {showing && report.paying.length > 0 ? (
        <Table data-testid="underwater-table">
          <THead>
            <TR>
              <TH>Account</TH>
              <TH>Pays</TH>
              <TH>Costs ({report.windowDays}d)</TH>
              <TH>Margin</TH>
            </TR>
          </THead>
          <TBody>
            {report.paying.map((account) => (
              <TR key={account.userId}>
                <TD className="text-ink">{account.userId}</TD>
                <TD className="text-ink">{microUsdMoney(account.paysMicroUsd)}</TD>
                <TD className="text-ink">{microUsdCost(account.costMicroUsd)}</TD>
                <TD className="text-danger-ink">{microUsdMargin(account.marginMicroUsd)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}

      {/* **Set aside, and counted.** Underwater by construction is not a
          finding, so these are never in the table above and are never
          enumerated — a count and what it costs is the whole of what the
          decision-maker needs, because the decision was already made. */}
      <div className="flex flex-col gap-1 border-t border-hairline pt-3">
        <Text as="span" className="text-xs uppercase tracking-wider text-slate">
          Underwater by construction
        </Text>
        {report.grantFunded.length === 0 ? (
          <Text variant="secondary" className="text-xs">
            No granted account is costing more than it pays right now.
          </Text>
        ) : (
          <div className="flex flex-wrap gap-2" data-testid="underwater-granted">
            {report.grantFunded.map((row) => (
              <Badge key={row.source} variant="neutral">
                {row.source}: {row.accounts} · {microUsdCost(row.costMicroUsd)}
              </Badge>
            ))}
          </div>
        )}
        <Text variant="secondary" className="text-xs">
          Comped on purpose — a founder, trial, referral or admin grant. Counted here and kept out
          of the list above, because mixing them in buries the rows that need an answer.
        </Text>
      </div>
    </div>
  );
}
