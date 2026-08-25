import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/components/lenses/formatMoney";
import type { TripSpend } from "@/lib/cost";

// Handoff `current/…dc.html:255-296`: a bordered pill, left column a headline
// spend total over "of <budget>", a slim moss track showing spend-vs-budget,
// right a Badge for the remaining/over figure. Money renders through
// formatMoney (KI-2/#46) — the shared formatter, not a hand-rolled string.
export function BudgetChip({
  spend,
  currency,
  onOpenSettings,
}: {
  spend: TripSpend;
  currency: string;
  onOpenSettings: () => void;
}) {
  if (spend.budget === null) {
    return (
      <Button
        variant="secondary"
        onClick={onOpenSettings}
        className="h-auto gap-3 rounded-full border-hairline py-1.5 pl-3.5 pr-2 text-sm font-normal text-slate"
      >
        Set a budget
      </Button>
    );
  }

  const pct = spend.budget > 0 ? Math.min(100, Math.max(0, (spend.total / spend.budget) * 100)) : 0;
  const remainingLabel =
    spend.remaining === null
      ? null
      : spend.over
        ? `${formatMoney(Math.abs(spend.remaining), currency)} over`
        : `${formatMoney(spend.remaining, currency)} left`;

  return (
    <Button variant="secondary" onClick={onOpenSettings} className="h-auto gap-3 rounded-full border-hairline py-1.5 pl-3.5 pr-2 font-normal">
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-sm text-ink">{formatMoney(spend.total, currency)}</span>
          <span className="font-mono text-xs text-slate">of {formatMoney(spend.budget, currency)}</span>
        </div>
        <div
          // Mitchell, reviewing the preview: "Budget bar should be full
          // length up to the 'Amount left' element." `w-full` resolves
          // against this flex-col's own shrink-to-fit width (CSS's
          // percentage-in-shrink-to-fit-container resolution), which is set
          // by the headline row above it — so the track spans exactly to
          // where that row ends, not the fixed 132px the handoff mock used.
          // The Badge is a separate flex item after this column, so "up to
          // the Amount left element" falls out for free.
          className="h-1 w-full overflow-hidden rounded-full bg-moss"
        >
          <div
            data-testid="budget-chip-fill"
            className={spend.over ? "h-full rounded-full bg-warning" : "h-full rounded-full bg-brand"}
            // eslint-disable-next-line no-restricted-syntax -- fill width is a spend/budget percentage, not expressible as a token
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {remainingLabel !== null && <Badge variant={spend.over ? "warning" : "neutral"}>{remainingLabel}</Badge>}
    </Button>
  );
}
