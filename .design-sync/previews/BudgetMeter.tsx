import { BudgetMeter } from "web";

export function UnderBudget() {
  return <BudgetMeter cost={12400} budget={20000} currency="EUR" />;
}

export function OverBudget() {
  return <BudgetMeter cost={24800} budget={20000} currency="EUR" />;
}
