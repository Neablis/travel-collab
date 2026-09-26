"use client";

import { CircleHelp, Ticket, type LucideIcon } from "lucide-react";
import { PendingReason } from "@tc/contracts";
import { IconRadioGroup } from "@/components/ui/icon-radio-group";

// Exhaustive on purpose, like `MODE_DISPLAY`: a third reason in the contract
// (ADR-055) fails to compile here until it has a name and an icon. The label is
// also the pending card's badge (activityKind.ts), so it stays one or two words
// (SPEC §36.9: "Card badges are one or two words and never wrap").
export const PENDING_REASON_DISPLAY: Record<PendingReason, { label: string; Icon: LucideIcon }> = {
  book: { label: "To book", Icon: Ticket },
  maybe: { label: "Maybe", Icon: CircleHelp },
};

const OPTIONS = PendingReason.options.map((value) => ({ value, ...PENDING_REASON_DISPLAY[value] }));

/** Why a pending stop is pending, as the same icon-only radio row a transit stop's mode uses. */
export function PendingReasonPicker({
  value,
  onChange,
}: {
  value: PendingReason | null;
  onChange: (next: PendingReason | null) => void;
}) {
  return <IconRadioGroup aria-label="Why it is pending" value={value} onValueChange={onChange} options={OPTIONS} />;
}
