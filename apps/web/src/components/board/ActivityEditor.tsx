"use client";

import { useState } from "react";
import type { ActivityView, Anchor, Location, Money, TimeWindow } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { LocationInput } from "./LocationInput";
import { MoneyInput } from "./MoneyInput";

export type ActivityFormValue = {
  title: string;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
  anchors: Anchor[];
  cost: Money | null;
};

export function ActivityEditor({
  initial,
  tripCurrency = "USD",
  onSave,
  onCancel,
}: {
  initial: ActivityView | null;
  tripCurrency?: string;
  onSave: (value: ActivityFormValue) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [start, setStart] = useState(initial?.timeWindow?.start ?? "");
  const [end, setEnd] = useState(initial?.timeWindow?.end ?? "");
  const [location, setLocation] = useState<Location | null>(initial?.location ?? null);
  // No UI reaches anchors (D-1, see packages/domain/src/trip/conflicts.ts) — the
  // editor never lets a user set them, but still round-trips whatever value the
  // activity already carries so existing anchors aren't silently dropped.
  const anchors: Anchor[] = initial?.anchors ?? [];
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [cost, setCost] = useState<Money | null>(initial?.cost ?? null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") return setError("Title is required");
    if ((start === "") !== (end === "")) return setError("Provide both start and end times");
    if (start !== "" && start >= end) return setError("End time must be after start time");
    onSave({
      title: trimmedTitle,
      timeWindow: start !== "" ? { start, end } : null,
      location,
      notes: notes.trim() !== "" ? notes.trim() : null,
      anchors,
      cost,
    });
  }

  return (
    <Card as="div">
      <form onSubmit={submit} className="grid gap-1.5">
        <FormField id="activity-title" label="Activity title">
          <Input
            id="activity-title"
            aria-label="Activity title"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </FormField>
        <div className="flex gap-1.5">
          <FormField id="activity-start-time" label="Start time">
            <Input
              id="activity-start-time"
              aria-label="Start time"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </FormField>
          <FormField id="activity-end-time" label="End time">
            <Input
              id="activity-end-time"
              aria-label="End time"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </FormField>
        </div>
        <LocationInput value={location} onChange={setLocation} />
        <FormField id="activity-cost" label="Cost">
          <MoneyInput value={cost} currency={tripCurrency} onChange={setCost} />
        </FormField>
        <FormField id="activity-notes" label="Notes">
          <Textarea
            id="activity-notes"
            aria-label="Notes"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>
        {error !== null && <Text as="p" role="alert" className="text-danger-ink">{error}</Text>}
        <div className="flex gap-1.5">
          <Button type="submit" variant="secondary" className="font-semibold">
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
