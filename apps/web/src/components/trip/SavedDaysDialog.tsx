"use client";

import { useCallback, useEffect, useState } from "react";
import type { SavedDay, TimeFormat } from "@tc/contracts";
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
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { savedDayFacts } from "@/lib/savedDayFacts";

// The other half of link 6: a day you kept, put back into a trip. The list is
// the whole "select a saved part" surface — no search, no tags, no sorting
// beyond newest-first, because a personal library of a handful of days does
// not need any of that yet, and inventing it would be inventing Playbooks
// (M11's own separate scope, still shelled).

/**
 * What a Playbook in the library says about itself, on the row whose button is
 * "Add to trip".
 *
 * **This used to compute the window itself, and over a sequence it stated
 * something false.** It read `stops[0].timeWindow.start` to
 * `stops[n].timeWindow.end` — which for a three-day Playbook is day 1's 07:30
 * to day 3's 15:30, rendered as a single clock range, exactly the claim
 * ADR-048 decision 4 says a sequence must refuse to make. `savedDayFacts` was
 * changed to return a null window above one day; this was a THIRD construction
 * of the same fact and never saw the change. Found by walking the preview, and
 * it is the same species of duplication `citiesOfDay` and `rollupCosts` exist
 * to prevent — an independent copy agrees right up until the rule moves.
 *
 * So it folds `savedDayFacts` now rather than reimplementing it, and it leads
 * with the DAY COUNT, because this is one of the surfaces M23 link 4 names: a
 * surface states the count it is acting on before it acts, and "Add to trip"
 * acts immediately.
 */
function spanOf(saved: SavedDay, clock: TimeFormat): string {
  const facts = savedDayFacts(saved.stops, saved.dayCount);
  const count = `${facts.stopCount} stop${facts.stopCount === 1 ? "" : "s"}`;
  const days = saved.dayCount > 1 ? `${saved.dayCount} days · ` : "";
  // Null above one day, and null for a day carrying no times — the surface
  // says nothing rather than something untrue, in both cases.
  return facts.window !== null
    ? `${days}${count} · ${toClockRange(facts.window.start, facts.window.end, clock)}`
    : `${days}${count}`;
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
  const clock = useTimeFormat();
  const [savedDays, setSavedDays] = useState<SavedDay[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchSavedDays();
    // Clearing on success matters because this dialog is reopened: without it
    // a failed load leaves its message sitting above the fresh list forever.
    // Same fix TravelersPanel and ShareButton took in an earlier round; link 6
    // was not in PR #70, so it never received it (CodeRabbit, PR #71).
    if (result.ok) {
      setSavedDays(result.value);
      setError(null);
    } else setError(result.error.message);
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
              <DataText size="xs">{spanOf(saved, clock)}</DataText>
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
