"use client";

import { useState } from "react";
import type { Anchor, Weekday } from "@tc/contracts";

const ANCHOR_KINDS = ["dayOfWeek", "dateRange", "timeOfDay", "publicHoliday"] as const;
type AnchorKind = (typeof ANCHOR_KINDS)[number];

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
    <div style={{ display: "grid", gap: 6 }}>
      {value.map((anchor, index) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>{describeAnchor(anchor)}</span>
          <button type="button" onClick={() => removeAnchor(index)}>
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label htmlFor="anchor-kind">anchor kind</label>
        <select id="anchor-kind" aria-label="anchor kind" value={kind} onChange={(e) => setKind(e.target.value as AnchorKind)}>
          {ANCHOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button type="button" onClick={addAnchor}>
          Add anchor
        </button>
      </div>
    </div>
  );
}
