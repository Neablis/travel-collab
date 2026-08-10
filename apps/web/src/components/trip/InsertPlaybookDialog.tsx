"use client";

import { useId, useMemo, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Preview } from "@/components/ui/preview";
import { PREVIEW_PLAYBOOK_CARDS } from "@/components/playbooks/preview-fixtures";

const TRIP_OPTIONS = [
  { value: "japan", label: "Japan: Tokyo → Kyoto → Osaka · Oct 2026" },
  { value: "nola", label: "New Orleans · Sep 2026" },
] as const;

const DAY_OPTIONS = Array.from({ length: 7 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` }));

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function fromMinutes(total: number): string {
  const normalized = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Handoff README "Insert-a-Playbook dialog": choose trip + day + start time
// and preview reflowed times ("09:00 → 10:30") — every stop in the chosen
// Playbook shifts by the same delta its first stop moves to reach the
// chosen start time (the prototype's own insPreview computation, just done
// here off `rawTimes` instead of its imperative state machine).
//
// The Preview wrap lives INSIDE this component (around the fields +
// footer), not around the call site — same lesson as KeepDayDialog.tsx
// (Task 17): Dialog renders its content through a Radix Portal straight to
// document.body, so a Preview wrapped around the outside of <Dialog> would
// never actually contain the portalled content in the DOM.
export function InsertPlaybookDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const playbookId = useId();
  const tripId = useId();
  const dayId = useId();
  const startId = useId();

  const [playbookIndex, setPlaybookIndex] = useState(0);
  const [tripValue, setTripValue] = useState<(typeof TRIP_OPTIONS)[number]["value"]>("japan");
  const [dayValue, setDayValue] = useState("1");
  const [startTime, setStartTime] = useState("09:00");

  const playbook = PREVIEW_PLAYBOOK_CARDS[playbookIndex] ?? PREVIEW_PLAYBOOK_CARDS[0]!;

  const shiftedTimes = useMemo(() => {
    const originalStart = toMinutes(playbook.rawTimes[0] ?? "00:00");
    const delta = toMinutes(startTime) - originalStart;
    return playbook.rawTimes.map((t) => fromMinutes(toMinutes(t) + delta));
  }, [playbook, startTime]);

  const spanNote =
    shiftedTimes.length > 0
      ? `${playbook.name} now runs ${shiftedTimes[0]} → ${shiftedTimes[shiftedTimes.length - 1]}.`
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a saved day to a trip">
      <Preview id="insert-playbook">
        <div className="flex flex-col gap-3.5">
          <FormField id={playbookId} label="Which Playbook">
            <NativeSelect
              id={playbookId}
              value={String(playbookIndex)}
              onChange={(e) => setPlaybookIndex(Number(e.target.value))}
            >
              {PREVIEW_PLAYBOOK_CARDS.map((pb, index) => (
                <option key={pb.id} value={index}>
                  {pb.name} · {pb.city}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField id={tripId} label="Which trip">
            <NativeSelect
              id={tripId}
              value={tripValue}
              onChange={(e) => setTripValue(e.target.value as (typeof TRIP_OPTIONS)[number]["value"])}
            >
              {TRIP_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField id={dayId} label="Which day">
              <NativeSelect id={dayId} value={dayValue} onChange={(e) => setDayValue(e.target.value)}>
                {DAY_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id={startId} label="Start it at">
              <Input id={startId} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </FormField>
          </div>

          {spanNote && <Banner variant="info">{spanNote}</Banner>}

          <div className="rounded-md border border-hairline bg-paper p-3">
            <div className="text-xs uppercase tracking-wide text-slate">After shifting</div>
            <div className="mt-2 flex flex-col gap-1">
              {playbook.preview.map((row, index) => (
                <div key={index} className="flex gap-2.5 text-sm">
                  <DataText size="xs" className="w-16 shrink-0 pt-0.5">
                    {shiftedTimes[index]}
                  </DataText>
                  <span className="text-ink">{row.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          {/* Deliberately no onClick on either control: this is a shell for
              M11's actual insert-into-trip mutation. Cancel is inert too —
              it's wrapped by the same Preview shield; use the Dialog's
              built-in title-row X (outside this Preview) to close it in the
              interim, same as KeepDayDialog's Cancel/Confirm. */}
          <Button type="button" variant="ghost">
            Cancel
          </Button>
          <Button type="button" variant="primary">
            Insert day
          </Button>
        </DialogFooter>
      </Preview>
    </Dialog>
  );
}
