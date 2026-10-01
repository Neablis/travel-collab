"use client";

import { Bike, Bus, Car, Footprints, Plane, Ship, TrainFront, type LucideIcon } from "lucide-react";
import { ActivityMode } from "@tc/contracts";
import { IconRadioGroup } from "@/components/ui/icon-radio-group";
import { MODE_LABEL } from "@/lib/travelMode";

// Exhaustive on purpose: an eighth mode in the contract fails to compile here
// rather than rendering a button with no icon and no name. The label is also
// the transit card's badge (activityKind.ts).
// The words live in `lib/travelMode.ts`, so a surface outside `board` can
// print them without importing this component.
export const MODE_DISPLAY: Record<ActivityMode, { label: string; Icon: LucideIcon }> = {
  walk: { label: MODE_LABEL.walk, Icon: Footprints },
  bus: { label: MODE_LABEL.bus, Icon: Bus },
  train: { label: MODE_LABEL.train, Icon: TrainFront },
  flight: { label: MODE_LABEL.flight, Icon: Plane },
  ferry: { label: MODE_LABEL.ferry, Icon: Ship },
  car: { label: MODE_LABEL.car, Icon: Car },
  bike: { label: MODE_LABEL.bike, Icon: Bike },
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
