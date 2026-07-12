"use client";
import { useEffect, useRef, useState } from "react";
import type { Money } from "@tc/contracts";
import { Input } from "@/components/ui/input";

function formatMoney(value: Money | null): string {
  return value ? (value.amountMinor / 100).toFixed(2) : "";
}

function moneyEqual(a: Money | null, b: Money | null): boolean {
  if (a === null || b === null) return a === b;
  return a.amountMinor === b.amountMinor && a.currency === b.currency;
}

function parseMoney(raw: string, currency: string): Money | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const amountMinor = Math.max(0, Math.round(Number(trimmed) * 100));
  return Number.isFinite(amountMinor) ? { amountMinor, currency } : null;
}

// 2-decimal minor-unit input (ADR-008 M4 simplification). Empty → null.
// Controlled, but only re-syncs its display from `value` when that prop
// actually changes (e.g. undo/redo, an external refetch) — never fights the
// user's own in-progress keystrokes.
//
// Commits (calls onChange) on blur or Enter, never per keystroke: some
// callers (e.g. TripMoneySettings) dispatch onChange straight to the server,
// and firing one command per digit typed raced concurrent round-trips
// against each other — the displayed value could snap back to an earlier,
// smaller keystroke's server-confirmed value instead of the final typed
// amount. Edge cases handled: Enter commits and blurs without letting the
// keystroke fall through to a surrounding <form>'s submit (ActivityEditor
// wraps this in one — without preventDefault, the native submit-on-Enter can
// fire before React flushes the just-typed value into that form's state,
// submitting a stale cost); Escape reverts to the last external value
// without committing; unmounting mid-edit (e.g. a parent removing this
// field before the user tabs away) still flushes any pending edit so a
// typed value is never silently dropped.
export function MoneyInput({ value, currency, onChange }: { value: Money | null; currency: string; onChange: (m: Money | null) => void }) {
  const [display, setDisplay] = useState(formatMoney(value));
  const prevValue = useRef(value);
  const cancelingRef = useRef(false);

  useEffect(() => {
    if (!moneyEqual(prevValue.current, value)) setDisplay(formatMoney(value));
    prevValue.current = value;
  }, [value]);

  // Read via a ref in the unmount cleanup below so it always sees the latest
  // props/state, not a stale closure from whenever this effect first ran.
  const latest = useRef({ display, value, currency, onChange });
  latest.current = { display, value, currency, onChange };
  useEffect(() => {
    return () => {
      const { display: d, value: v, currency: c, onChange: fn } = latest.current;
      if (d !== formatMoney(v)) fn(parseMoney(d, c));
    };
  }, []);

  return (
    <Input
      type="number" step="0.01" min="0" aria-label={`cost (${currency})`} placeholder={`0.00 ${currency}`}
      value={display}
      onChange={(e) => setDisplay(e.target.value)}
      onBlur={(e) => {
        if (cancelingRef.current) {
          cancelingRef.current = false;
          return;
        }
        onChange(parseMoney(e.target.value, currency));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelingRef.current = true;
          setDisplay(formatMoney(value));
          e.currentTarget.blur();
        }
      }}
    />
  );
}
