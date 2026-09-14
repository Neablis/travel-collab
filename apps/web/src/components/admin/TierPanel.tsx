import { Panel } from "@/components/ui/panel";
import { Text } from "@/components/ui/text";
import type { AdminPlanPanelRow } from "@/lib/adminOverview";

// **"How each tier is doing"** — the design's right-hand panel (handoff design,
// *Operator console* artboard). A block per tier rather than a table row,
// because each tier carries a nested list (its published versions and who is
// still on each), and a table with a list in a cell is the shape the design
// moved away from.
//
// **Two of the four stats the design draws are M21 link 7's**: MRR and median
// margin both need a subscription to exist, and so does the price beside each
// version row. Accounts and median cost are M20's and are here. This is the
// same split as the four-number strip, and the milestone is explicit that an
// implementer working from the finished screen builds the revenue half inside
// M20 — so the absence is deliberate and is the thing to check in review.

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
