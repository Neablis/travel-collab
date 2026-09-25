"use client";

import { useRef } from "react";
import { Bike, Bus, Car, Footprints, Plane, Ship, TrainFront, type LucideIcon } from "lucide-react";
import { ActivityMode } from "@tc/contracts";
import { Button } from "@/components/ui/button";

// Exhaustive on purpose: an eighth mode in the contract fails to compile here
// rather than rendering a button with no icon and no name.
const MODE_DISPLAY: Record<ActivityMode, { label: string; Icon: LucideIcon }> = {
  walk: { label: "On foot", Icon: Footprints },
  bus: { label: "Bus", Icon: Bus },
  train: { label: "Train", Icon: TrainFront },
  flight: { label: "Flight", Icon: Plane },
  ferry: { label: "Ferry", Icon: Ship },
  car: { label: "Car", Icon: Car },
  bike: { label: "Bike", Icon: Bike },
};

const MODES = ActivityMode.options;

/**
 * How a transit leg travels, as a row of icon-only radios (preview feedback on
 * #230 — the select and its "Travelling by" header went). The header is gone
 * but the group still carries the name, and each icon its mode's name, so a
 * screen reader hears what a sighted user reads off the icon.
 *
 * Clicking the chosen mode again clears it back to `null`: that replaces the
 * select's "Not said" option, since a native radio group has no way back to
 * nothing chosen. Roving `tabIndex` and arrow keys match ReportDialog's
 * `ReasonGroup` — one tab stop, arrows move the choice.
 */
export function TravelModePicker({
  value,
  onChange,
}: {
  value: ActivityMode | null;
  onChange: (next: ActivityMode | null) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = Math.max(0, value === null ? 0 : MODES.indexOf(value));
  const moveTo = (next: number) => {
    const i = (next + MODES.length) % MODES.length;
    onChange(MODES[i]!);
    refs.current[i]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Travelling by" className="flex flex-wrap gap-1.5">
      {MODES.map((mode, i) => {
        const on = value === mode;
        const { label, Icon } = MODE_DISPLAY[mode];
        return (
          <Button
            key={mode}
            ref={(el) => {
              refs.current[i] = el;
            }}
            variant={on ? "primary" : "secondary"}
            size="icon"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onChange(on ? null : mode)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault();
                moveTo(i + 1);
              } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault();
                moveTo(i - 1);
              }
            }}
          >
            <Icon className="size-4" aria-hidden />
          </Button>
        );
      })}
    </div>
  );
}
