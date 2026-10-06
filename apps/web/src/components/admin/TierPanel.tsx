"use client";

import { useState } from "react";
import type { PlanId } from "@tc/contracts";
import { DataText } from "@/components/ui/data-text";
import { Panel } from "@/components/ui/panel";
import { TabStrip } from "@/components/ui/tab-strip";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import type { AdminPlanPanelRow, AdminPlanPriceView } from "@/lib/adminOverview";
import { microUsdCost, microUsdMargin, microUsdMoney } from "./microUsd";

// **"How each tier is doing", one tier per tab** (M36 link 1, spec § Financial).
// It was a block per tier stacked in one column; beside *Costs more than it
// pays* in a 340px-minimum grid that made the right-hand panel three times the
// height of the left, so the design moved the tiers behind a `TabStrip`.
//
// **Order is the wire's, reversed — not a sort on the plan file's ladder
// field.** The server sends plans in the plan file's declaration order, which
// `planVersions.noExtension.test.ts` asserts IS ladder order, and that same
// test refuses any new file that so much as names the field: the ladder is not
// read outside an exact allowlist (`accountPlan.ts` met the same wall and took
// the same way round). Reversed, it is the design's premium · plus · free.
//
// **MRR and median margin are not the same number twice.** MRR is summed over
// the versions this tier's subscribers pinned, so a tier whose price rose
// reports the mix; the margin median is among PAYERS, while the cost median
// counts every holder, comped ones included — subtracting a price from it would
// compare a cost across all holders with money only some of them send.

/** A plan file price, which is cents, through the console's one money formatter. */
function priceLabel(price: AdminPlanPriceView | null): string {
  // `null` is *not sold* (studio), a different fact from a real zero (free).
  if (price === null) return "not sold";
  if (price.minor === 0) return "free";
  return `${microUsdMoney(price.minor * 10_000)} / month`;
}

/** The first tier someone pays for is what an operator opens the panel to see. */
function defaultTier(plans: readonly AdminPlanPanelRow[]): PlanId | undefined {
  return (plans.find((plan) => (plan.live.price?.minor ?? 0) > 0) ?? plans[0])?.planId;
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-3.5 py-3">
      <Text as="span" className="text-xs text-slate">
        {label}
      </Text>
      <DataText className="text-lg font-semibold text-ink" data-testid={testId}>
        {value}
      </DataText>
    </div>
  );
}

export function TierPanel({ plans }: { plans: readonly AdminPlanPanelRow[] }) {
  const ordered = [...plans].reverse();
  const [selected, setSelected] = useState(() => defaultTier(ordered));
  const plan = ordered.find((row) => row.planId === selected);

  return (
    <Panel title="How each tier is doing">
      <div className="flex flex-col gap-4" data-testid="tier-panel">
        <div>
          <TabStrip
            value={selected}
            onValueChange={setSelected}
            options={ordered.map((row) => ({ value: row.planId, label: row.planId }))}
            aria-label="Tier"
          />
        </div>

        {plan === undefined ? null : (
          <div className="flex flex-col gap-4" data-testid={`plan-${plan.planId}`}>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="font-display text-lg font-semibold text-ink">{plan.planId}</span>
                {/* **What the LIVE version costs**, which is what a new
                    purchase would pin — not what any existing subscriber pays,
                    since each of those pins its own version. */}
                <DataText data-testid="tier-price">{priceLabel(plan.live.price)}</DataText>
                {!plan.live.enabled && (
                  <Text as="span" className="text-xs text-slate">
                    (disabled)
                  </Text>
                )}
              </div>
              {/* **Decided by the empty set, never by which plan this is**
                  (ADR-045 rule 4; `planVersions.fourthPlan.test.ts` walks every
                  source file for a plan-id comparison). A blank reads as
                  missing data; the sentence reads as a decision. */}
              <Text as="span" className="text-xs text-slate" data-testid="tier-grants">
                {plan.live.entitlements.length === 0
                  ? "Planning only — no ai.*, no collaborators"
                  : `Grants ${plan.live.entitlements.join(" · ")}`}
              </Text>
            </div>

            {/* Hairlines between the four cells are the grid's own background
                showing through a 1px gap, so no cell owns a border. */}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline">
              <Stat label="Accounts" value={String(plan.accounts)} testId="tier-accounts" />
              <Stat label="MRR" value={microUsdMoney(plan.mrrMicroUsd)} testId="tier-mrr" />
              <Stat
                label="Median cost · 30 days"
                value={microUsdCost(plan.medianMicroUsd)}
                testId="tier-median-cost"
              />
              <Stat
                label="Median margin · payers"
                value={microUsdMargin(plan.medianMarginMicroUsd)}
                testId="tier-median-margin"
              />
            </div>

            {/* Every published version, newest first, with who is still on it —
                the question this panel exists for now that publishing has left
                the UI. */}
            <div className="flex flex-col gap-1.5">
              <Text as="span" className="text-2xs font-semibold uppercase tracking-wider text-slate">
                Published versions
              </Text>
              <Table data-testid="tier-versions">
                <THead>
                  <TR>
                    <TH>Version</TH>
                    <TH className="text-right">Price</TH>
                    <TH>Published</TH>
                    <TH className="text-right">Accounts on it</TH>
                  </TR>
                </THead>
                <TBody>
                  {[...plan.versions].reverse().map((version) => (
                    <TR key={version.version} data-testid={`plan-${plan.planId}-v${version.version}`}>
                      <TD>
                        <DataText className="text-ink">
                          v{version.version}
                          {version.version === plan.live.version ? " · live" : ""}
                        </DataText>
                      </TD>
                      <TD className="text-right">
                        <DataText className="text-ink">{priceLabel(version.price)}</DataText>
                      </TD>
                      <TD>
                        <DataText as="time" dateTime={version.publishedAt}>
                          {version.publishedAt}
                        </DataText>
                      </TD>
                      <TD className="text-right">
                        <DataText className="text-ink">
                          {plan.holdsByVersion[version.version] ?? 0}
                        </DataText>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </div>
        )}

        <Text as="span" className="text-xs text-slate">
          Read-only. Versions are published from the repo, not from here.
        </Text>
      </div>
    </Panel>
  );
}
