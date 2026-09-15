import { Panel } from "@/components/ui/panel";
import { Text } from "@/components/ui/text";
import type { AdminPlanPanelRow } from "@/lib/adminOverview";
import { microUsdMargin, microUsdMoney } from "./microUsd";

// **"How each tier is doing"** — the design's right-hand panel (handoff design,
// *Operator console* artboard). A block per tier rather than a table row,
// because each tier carries a nested list (its published versions and who is
// still on each), and a table with a list in a cell is the shape the design
// moved away from.
//
// **The panel was split down the middle and M21 link 7 filled the other half.**
// Accounts and median cost are M20's; **MRR and median margin per tier** need a
// subscription to exist and arrived with this milestone, as did the price
// beside the tier's name. The split was real while it lasted and the absence
// was the thing to check in review; what is worth checking now is the line
// below it — that the two medians are not the same number with a price
// subtracted.

function microUsd(value: number | null): string {
  return value === null ? "—" : `$${(value / 1_000_000).toFixed(4)}`;
}

export function TierPanel({ plans }: { plans: readonly AdminPlanPanelRow[] }) {
  return (
    <Panel title="How each tier is doing">
      <div className="flex flex-col gap-4" data-testid="tier-panel">
        {plans.map((plan, index) => (
          // A rule between tiers, not around each one: the design separates
          // them with a hairline rather than boxing three cards inside a panel
          // that is already a box.
          <div
            key={plan.planId}
            className={`flex flex-col gap-2${index > 0 ? " border-t border-hairline pt-4" : ""}`}
            data-testid={`plan-${plan.planId}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Text as="span" className="text-base font-semibold text-ink">
                {plan.planId}
                {/* **What the LIVE version costs**, which is what a new
                    purchase would pin — not what any existing subscriber pays,
                    since each of those pins its own version. The MRR figure
                    beside it is the one that knows the difference. */}
                {plan.live.price === null ? null : (
                  <span className="ml-1.5 text-xs text-slate">
                    {plan.live.price.minor === 0
                      ? "free"
                      : `${microUsdMoney(plan.live.price.minor * 10_000)}/mo`}
                  </span>
                )}
                {!plan.live.enabled && <span className="ml-1 text-xs text-slate">(disabled)</span>}
              </Text>
              {/* The design spells the free tier's empty set as prose rather
                  than a dash: "planning only — no ai.*, no collaborators". A
                  blank cell reads as missing data; this reads as a decision. */}
              <Text as="span" className="text-xs text-slate">
                {plan.live.entitlements.length === 0
                  ? "planning only — no ai.*, no collaborators"
                  : plan.live.entitlements.join(" · ")}
              </Text>
            </div>

            {/* The stat row the design draws: the number is the thing being
                read, so it carries the weight and the label sits under it in
                slate — not a label-colon-value line, which is what this was. */}
            <div className="flex flex-wrap gap-8">
              <div className="flex flex-col">
                <Text as="span" className="text-lg font-semibold text-ink">
                  {plan.accounts}
                </Text>
                <Text as="span" className="text-xs text-slate">
                  accounts
                </Text>
              </div>
              <div className="flex flex-col">
                <Text as="span" className="text-lg font-semibold text-ink">
                  {microUsd(plan.medianMicroUsd)}
                </Text>
                <Text as="span" className="text-xs text-slate">
                  median cost {"·"} 30d
                </Text>
              </div>
              {/* **M21 link 7's two columns.** MRR is what this tier actually
                  brings in, summed over the versions its subscribers pinned —
                  so a tier whose price rose reports the mix, not the new
                  price times the head count. */}
              <div className="flex flex-col">
                <Text as="span" className="text-lg font-semibold text-ink" data-testid={`tier-mrr-${plan.planId}`}>
                  {microUsdMoney(plan.mrrMicroUsd)}
                </Text>
                <Text as="span" className="text-xs text-slate">
                  MRR
                </Text>
              </div>
              <div className="flex flex-col">
                <Text as="span" className="text-lg font-semibold text-ink">
                  {microUsdMargin(plan.medianMarginMicroUsd)}
                </Text>
                {/* **Among PAYERS, and that is why it is not the cost median
                    minus a price.** The cost median counts every holder,
                    including the comped ones; subtracting a price from it
                    would compare a cost across all holders with money only
                    some of them send. */}
                <Text as="span" className="text-xs text-slate">
                  median margin {"·"} payers
                </Text>
              </div>
              <div className="flex flex-col">
                <Text as="span" className="text-lg font-semibold text-ink">
                  {plan.live.ceilings.perUserRequestsPerDay ?? "env"}
                  {" / "}
                  {plan.live.ceilings.perUserStepsPerDay ?? "env"}
                </Text>
                <Text as="span" className="text-xs text-slate">
                  requests / steps a day
                </Text>
              </div>
            </div>

            {/* Every published version, with who is still on it — the question
                this panel exists for now that publishing has left the UI. */}
            <ul className="flex flex-col gap-0.5">
              {plan.versions.map((version) => (
                <li
                  key={version.version}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                  data-testid={`plan-${plan.planId}-v${version.version}`}
                >
                  <Text as="span" className="text-xs text-ink">
                    v{version.version}
                    <span className="ml-2 text-slate">published {version.publishedAt}</span>
                  </Text>
                  <Text as="span" className="text-xs text-slate">
                    {plan.holdsByVersion[version.version] ?? 0} hold
                  </Text>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <Text as="span" className="text-xs text-slate">
          Read-only. Versions are published from the repo, not from here — this page is for
          seeing which tier is worth keeping, and who is on an older one.
        </Text>
      </div>
    </Panel>
  );
}
