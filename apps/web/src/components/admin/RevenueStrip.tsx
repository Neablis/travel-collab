import { Text } from "@/components/ui/text";
import type { AdminRevenueView } from "@/lib/adminOverview";
import { microUsdMargin, microUsdMoney } from "./microUsd";

// **The four-number strip** (M21 link 7), which M20's console deliberately did
// not have because every one of these needs a subscription to exist.
//
// **ARPU is here twice and both are labelled**, which is the link's most
// emphatic requirement and the easiest to quietly drop: *"with founder,
// referral, trial and admin grants in the mix these differ a lot, and a single
// unlabelled ARPU will be quoted as whichever is convenient."* On this
// deployment every account predating M20's migration holds a permanent founder
// grant, so the gap between the two is not hypothetical — it is most of the
// account base.
//
// **Margin is a median over a trailing 30 days, never lifetime.** Cost is
// spiky; one heavy month is not a signal.

function Figure({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note?: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-hairline p-3" data-testid={testId}>
      <Text as="span" className="text-xs uppercase tracking-wider text-slate">
        {label}
      </Text>
      <Text as="span" className="text-xl font-semibold text-ink">
        {value}
      </Text>
      {note === undefined ? null : (
        <Text variant="secondary" className="text-xs">
          {note}
        </Text>
      )}
    </div>
  );
}

export function RevenueStrip({ revenue }: { revenue: AdminRevenueView }) {
  return (
    <div className="flex flex-col gap-2" data-testid="revenue-strip">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="MRR"
          value={microUsdMoney(revenue.mrrMicroUsd)}
          // **Two numbers, not a net.** "MRR is flat" covers a month that
          // gained and lost the same amount and a month where nothing happened,
          // and those are different businesses.
          note={`+${microUsdMoney(revenue.addedMicroUsd)} added · −${microUsdMoney(revenue.lostMicroUsd)} lost (${revenue.windowDays}d)`}
          testId="revenue-mrr"
        />
        <Figure
          label="ARPU · all accounts"
          value={microUsdMoney(revenue.arpuAllMicroUsd)}
          note={`Across all ${revenue.accounts} accounts, paying or not`}
          testId="revenue-arpu-all"
        />
        <Figure
          label="ARPU · paying only"
          value={microUsdMoney(revenue.arpuPayingMicroUsd)}
          note={`Across the ${revenue.payingAccounts} that pay`}
          testId="revenue-arpu-paying"
        />
        <Figure
          label="Median margin"
          value={microUsdMargin(revenue.medianMarginMicroUsd)}
          note={`Per paying account, trailing ${revenue.windowDays} days`}
          testId="revenue-median-margin"
        />
      </div>
      {/* **`webhooks-behind`, the state M21 link 7 names as its own** — revenue
          numbers stamped stale, with grants still applying, because grants do
          not go through Stripe. The honest version of it here is a
          subscription this deploy cannot price: its pinned version is not in
          the committed plan file, so MRR understates and nothing errors. */}
      {revenue.unpricedSubscriptions > 0 ? (
        <Text variant="secondary" className="text-xs" data-testid="revenue-unpriced">
          {revenue.unpricedSubscriptions} subscription
          {revenue.unpricedSubscriptions === 1 ? "" : "s"} pin a plan version this deploy cannot
          price, so MRR is a floor rather than a total.
        </Text>
      ) : null}
    </div>
  );
}
