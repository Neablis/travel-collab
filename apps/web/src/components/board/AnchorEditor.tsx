"use client";

import { useState } from "react";
import type { Anchor, Weekday } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/native-select";
import { Text } from "@/components/ui/text";

const ANCHOR_KINDS = ["dayOfWeek", "dateRange", "timeOfDay", "publicHoliday"] as const;
type AnchorKind = (typeof ANCHOR_KINDS)[number];

// Option text only — friendlier than the raw enum values, which remain the
// submitted `value` attributes untouched.
const ANCHOR_KIND_LABELS: Record<AnchorKind, string> = {
  dayOfWeek: "Day of the week",
  dateRange: "Date range",
  timeOfDay: "Time of day",
  publicHoliday: "Public holiday",
};

const DEFAULT_DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultAnchorFor(kind: AnchorKind): Anchor {
  switch (kind) {
    case "dayOfWeek":
      return { kind: "dayOfWeek", days: DEFAULT_DAYS };
    case "dateRange": {
      const today = todayIso();
      return { kind: "dateRange", from: today, to: today };
    }
    case "timeOfDay":
      return { kind: "timeOfDay", window: { start: "08:00", end: "13:00" } };
    case "publicHoliday":
      return { kind: "publicHoliday", country: "US" };
  }
}

function describeAnchor(anchor: Anchor): string {
  switch (anchor.kind) {
    case "dayOfWeek":
      return `Days: ${anchor.days.join(", ")}`;
    case "dateRange":
      return `Dates: ${anchor.from} to ${anchor.to}`;
    case "timeOfDay":
      return `Time: ${anchor.window.start}-${anchor.window.end}`;
    case "publicHoliday":
      return `Public holiday: ${anchor.country}`;
  }
}

export function AnchorEditor({
  value,
  onChange,
}: {
  value: Anchor[];
  onChange: (next: Anchor[]) => void;
}) {
  const [kind, setKind] = useState<AnchorKind>("dayOfWeek");

  function addAnchor() {
    onChange([...value, defaultAnchorFor(kind)]);
  }

  function removeAnchor(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="grid gap-1.5">
      {value.map((anchor, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Text as="span">{describeAnchor(anchor)}</Text>
          <Button variant="ghost" onClick={() => removeAnchor(index)}>
            Remove
          </Button>
        </div>
      ))}
      <div className="flex items-end gap-1.5">
        <FormField
          id="anchor-kind"
          label="Lock to a date rule"
          description="Ties this event to a rule — e.g. a specific date or every Monday — so it flags a conflict if trip dates shift."
        >
          <NativeSelect
            id="anchor-kind"
            aria-label="anchor kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AnchorKind)}
          >
            {ANCHOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {ANCHOR_KIND_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <Button variant="secondary" onClick={addAnchor}>
          Add anchor
        </Button>
      </div>
    </div>
  );
}
