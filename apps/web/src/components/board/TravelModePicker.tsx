"use client";

import { Bike, Bus, Car, Footprints, Plane, Ship, TrainFront, type LucideIcon } from "lucide-react";
import { ActivityMode } from "@tc/contracts";
import { IconRadioGroup } from "@/components/ui/icon-radio-group";

// Exhaustive on purpose: an eighth mode in the contract fails to compile here
// rather than rendering a button with no icon and no name. The label is also
// the transit card's badge (activityKind.ts).
export const MODE_DISPLAY: Record<ActivityMode, { label: string; Icon: LucideIcon }> = {
  walk: { label: "On foot", Icon: Footprints },
  bus: { label: "Bus", Icon: Bus },
  train: { label: "Train", Icon: TrainFront },
  flight: { label: "Flight", Icon: Plane },
  ferry: { label: "Ferry", Icon: Ship },
  car: { label: "Car", Icon: Car },
  bike: { label: "Bike", Icon: Bike },
};

const OPTIONS = ActivityMode.options.map((value) => ({ value, ...MODE_DISPLAY[value] }));

/**
 * How a transit leg travels, as a row of icon-only radios (preview feedback on
 * #230 — the select and its "Travelling by" header went). The mechanics —
 * naming, roving focus, click-again-to-clear — are `IconRadioGroup`'s, shared
 * with `PendingReasonPicker`.
 */
export function TravelModePicker({
  value,
  onChange,
}: {
  value: ActivityMode | null;
  onChange: (next: ActivityMode | null) => void;
}) {
  return <IconRadioGroup aria-label="Travelling by" value={value} onValueChange={onChange} options={OPTIONS} />;
}
