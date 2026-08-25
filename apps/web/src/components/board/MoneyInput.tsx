"use client";
import { useEffect, useRef, useState } from "react";
import type { Money } from "@tc/contracts";
import { Input } from "@/components/ui/input";
import { formatAmount } from "@/components/lenses/formatMoney";

// Grouped display when idle (e.g. 1,111,106.00); raw digits are still accepted
// while typing. Uses the shared formatAmount so grouping matches the lenses.
function formatMoney(value: Money | null): string {
  return value ? formatAmount(value.amountMinor) : "";
}

function moneyEqual(a: Money | null, b: Money | null): boolean {
  if (a === null || b === null) return a === b;
  return a.amountMinor === b.amountMinor && a.currency === b.currency;
}

function parseMoney(raw: string, currency: string): Money | null {
  const trimmed = raw.replace(/,/g, "").trim(); // strip grouping separators
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
export function MoneyInput({
  id,
  value,
  currency,
  onChange,
  placeholder,
  className,
}: {
  // Optional: lets a caller's own FormField `id`/`htmlFor` actually resolve
  // to this input (Task 4.2 — TripMoneySettings' "Total for the trip" needs
  // getByLabelText to work via the real label-for link, not just this
  // input's own aria-label below). Omitted callers (e.g. ActivityEditor's
  // cost field) are unaffected — no id renders, same as before.
  id?: string;
  value: Money | null;
  currency: string;
  onChange: (m: Money | null) => void;
  // Optional: the add-stop sheet's Cost field (Phase 7, Task 7.1) wants an
  // example-value placeholder ("e.g. 120") instead of the default "0.00
  // {currency}" hint. Omitted callers keep the original placeholder.
  placeholder?: string;
  // Optional: TripMoneySettings reserves room for its trailing clear-X here
  // rather than fighting an inset with a one-off wrapper. Omitted callers
  // are unaffected.
  className?: string;
}) {
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
      id={id}
      type="text" inputMode="decimal" aria-label={id ? undefined : `cost (${currency})`} placeholder={placeholder ?? `0.00 ${currency}`}
      className={className}
      value={display}
      onChange={(e) => setDisplay(e.target.value)}
      onBlur={(e) => {
        if (cancelingRef.current) {
          cancelingRef.current = false;
          return;
        }
        const parsed = parseMoney(e.target.value, currency);
        onChange(parsed);
        setDisplay(formatMoney(parsed)); // re-group after commit
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
