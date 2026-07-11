"use client";
import { useEffect, useRef, useState } from "react";
import type { Money } from "@tc/contracts";

function formatMoney(value: Money | null): string {
  return value ? (value.amountMinor / 100).toFixed(2) : "";
}

function moneyEqual(a: Money | null, b: Money | null): boolean {
  if (a === null || b === null) return a === b;
  return a.amountMinor === b.amountMinor && a.currency === b.currency;
}

const COMMIT_DEBOUNCE_MS = 500;

// 2-decimal minor-unit input (ADR-008 M4 simplification). Empty → null.
// Controlled, but only re-syncs its display from `value` when that prop
// actually changes (e.g. undo/redo, an external refetch) — never fights the
// user's own in-progress keystrokes.
//
// onChange (which some callers, e.g. TripMoneySettings, dispatch straight to
// the server on every call) is debounced rather than fired per keystroke:
// typing a multi-digit amount without debouncing fired one command per
// digit, and since those async round-trips can resolve out of order, the
// displayed value could snap back to an earlier, smaller keystroke's
// server-confirmed value instead of the final typed amount. Debouncing
// collapses a typing burst into one commit; blur flushes immediately so
// tabbing away doesn't wait out the debounce window.
export function MoneyInput({ value, currency, onChange }: { value: Money | null; currency: string; onChange: (m: Money | null) => void }) {
  const [display, setDisplay] = useState(formatMoney(value));
  const prevValue = useRef(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!moneyEqual(prevValue.current, value)) setDisplay(formatMoney(value));
    prevValue.current = value;
  }, [value]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  function commit(raw: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (raw === "") return onChange(null);
    const amountMinor = Math.max(0, Math.round(Number(raw) * 100));
    onChange(Number.isFinite(amountMinor) ? { amountMinor, currency } : null);
  }

  return (
    <input
      type="number" step="0.01" min="0" aria-label={`cost (${currency})`} placeholder={`0.00 ${currency}`}
      value={display}
      onChange={(e) => {
        const raw = e.target.value.trim();
        setDisplay(raw);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => commit(raw), COMMIT_DEBOUNCE_MS);
      }}
      onBlur={(e) => commit(e.target.value.trim())}
    />
  );
}
