"use client";
import type { Money } from "@tc/contracts";

// 2-decimal minor-unit input (ADR-008 M4 simplification). Empty → null.
export function MoneyInput({ value, currency, onChange }: { value: Money | null; currency: string; onChange: (m: Money | null) => void }) {
  const display = value ? (value.amountMinor / 100).toFixed(2) : "";
  return (
    <input
      type="number" step="0.01" min="0" aria-label={`cost (${currency})`} placeholder={`0.00 ${currency}`}
      defaultValue={display}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") return onChange(null);
        const amountMinor = Math.max(0, Math.round(Number(raw) * 100));
        onChange(Number.isFinite(amountMinor) ? { amountMinor, currency } : null);
      }}
    />
  );
}
