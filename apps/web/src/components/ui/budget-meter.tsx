import { DataText } from "./data-text";
import { cn } from "../../lib/cn";
import { formatMoney } from "@/components/lenses/formatMoney";

// Read-only spent-vs-budget glance for the header (#30). Fill is brand under
// budget, warning-amber over (over budget is a warning, not a failure).
export function BudgetMeter({ cost, budget, currency }: { cost: number; budget: number; currency: string }) {
  const over = cost > budget;
  const pct = budget > 0 ? Math.min(100, (cost / budget) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-moss">
        <div
          data-testid="budget-meter-fill"
          className={cn("h-full rounded-full", over ? "bg-warning" : "bg-brand")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* formatMoney, not a second hand-rolled formatter (9ae98aa's
          CURRENCY_SYMBOLS) — a bare "of {currency}" tail rendered a code
          (USD) here after that commit routed everything else through
          symbols, visibly disagreeing with the rest of the UI. */}
      <DataText size="sm" className={cn(over && "text-warning-ink")}>
        {formatMoney(cost, currency)} of {formatMoney(budget, currency)}
      </DataText>
    </div>
  );
}
