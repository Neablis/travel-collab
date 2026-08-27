"use client";

import { useCallback, useEffect, useState } from "react";
import type { SavedDay } from "@tc/contracts";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import {
  deleteSavedDay,
  fetchSavedDays,
  insertSavedDay,
  type CommandOutcome,
} from "@/lib/apiClient";
import { toClockRange } from "@/lib/time";

// The other half of link 6: a day you kept, put back into a trip. The list is
// the whole "select a saved part" surface — no search, no tags, no sorting
// beyond newest-first, because a personal library of a handful of days does
// not need any of that yet, and inventing it would be inventing Playbooks
// (M11's own separate scope, still shelled).

function spanOf(saved: SavedDay): string {
  const windows = saved.stops.map((s) => s.timeWindow).filter((w) => w !== null);
  const first = windows[0];
  const last = windows[windows.length - 1];
  const count = `${saved.stops.length} stop${saved.stops.length === 1 ? "" : "s"}`;
  return first !== undefined && last !== undefined
    ? `${count} · ${toClockRange(first.start, last.end)}`
    : count;
}

export function SavedDaysDialog({
  open,
  onOpenChange,
  tripId,
  onInserted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  // The insert returns the authoritative detail + history, exactly like a
  // command batch — because it IS one. The caller feeds it straight into
  // TripProvider's applyOutcome rather than refetching.
  onInserted: (outcome: CommandOutcome) => void;
}) {
  const [savedDays, setSavedDays] = useState<SavedDay[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchSavedDays();
    if (result.ok) setSavedDays(result.value);
    else setError(result.error.message);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function insert(saved: SavedDay) {
    setBusy(true);
    setError(null);
    const result = await insertSavedDay(tripId, saved.savedDayId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onOpenChange(false);
    onInserted(result.value);
  }

  async function remove(saved: SavedDay) {
    setBusy(true);
    const result = await deleteSavedDay(saved.savedDayId);
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    await load();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a saved day">
      <div className="flex flex-col gap-2.5" data-testid="saved-days-list">
        {savedDays !== null && savedDays.length === 0 && (
          <Text variant="secondary">
            Nothing kept yet. Use the pennant on a day in Timeline to keep it.
          </Text>
        )}
        {(savedDays ?? []).map((saved) => (
          <Card key={saved.savedDayId} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <Text as="span" className="block truncate text-sm font-semibold text-ink">
                {saved.name}
              </Text>
              <DataText size="xs">{spanOf(saved)}</DataText>
              {/* The source trip's name as it was when the day was kept — a
                  snapshot, so it survives that trip being renamed or deleted
                  (the same argument ADR-028 makes for lineage). */}
              <Text as="span" variant="muted" className="block truncate">
                From {saved.sourceTripName}
              </Text>
            </div>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void insert(saved)}>
              Add to trip
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Forget ${saved.name}`}
              disabled={busy}
              onClick={() => void remove(saved)}
            >
              Forget
            </Button>
          </Card>
        ))}
        {error !== null && (
          <Text as="span" className="text-xs text-danger-ink">
            {error}
          </Text>
        )}
      </div>
    </Dialog>
  );
}
