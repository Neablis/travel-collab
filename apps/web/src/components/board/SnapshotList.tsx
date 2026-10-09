"use client";

import { useEffect, useState } from "react";
import { SNAPSHOT_NAME_MAX, type TripSnapshot } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import {
  deleteTripSnapshot,
  fetchTripSnapshots,
  renameTripSnapshot,
  restoreTripSnapshot,
  saveTripSnapshot,
  type CommandOutcome,
} from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { formatTripDate } from "@/lib/formatDate";

// Which row is mid-rename or mid-delete. One at a time: a second row's control
// replaces the first's rather than stacking two inline forms in a popover.
type RowMode = { id: string; kind: "rename" | "delete" } | null;

/**
 * Named snapshots (M40 part 2), above the History scroll. Anyone who may read
 * the trip sees the list and can preview one; saving, renaming, deleting and
 * restoring are an editor's (D5), so a reader with none is shown nothing.
 * `busy` is the board's unsent work: a snapshot is saved, and a restore
 * decided, against the server's head, which does not hold it yet.
 */
export function SnapshotList({
  tripId,
  canEdit,
  busy = false,
  previewSeq,
  onPreview,
  onExitPreview,
  onRestored,
}: {
  tripId: string;
  canEdit: boolean;
  busy?: boolean;
  previewSeq: number | null;
  onPreview: (seq: number) => void;
  onExitPreview: () => void;
  onRestored: (outcome: CommandOutcome) => void;
}) {
  const [snapshots, setSnapshots] = useState<TripSnapshot[] | null>(null);
  const [name, setName] = useState("");
  const [draftName, setDraftName] = useState("");
  const [mode, setMode] = useState<RowMode>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchTripSnapshots(tripId).then((result) => {
      // A failed read leaves the section out rather than saying "none".
      if (live && result.ok) setSnapshots(result.value);
    });
    return () => {
      live = false;
    };
  }, [tripId]);

  if (snapshots === null || (!canEdit && snapshots.length === 0)) return null;

  // Every write goes through here: one at a time, and the server's refusal
  // (the cap's reason above all) is what the reader is told.
  async function act<T>(run: () => Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>, then: (value: T) => void) {
    setWorking(true);
    setError(null);
    const result = await run();
    setWorking(false);
    if (!result.ok) return setError(result.error.message);
    setMode(null);
    then(result.value);
  }

  const save = () =>
    act(
      () => saveTripSnapshot(tripId, { name }),
      (saved) => {
        setSnapshots((list) => [saved, ...(list ?? [])]);
        setName("");
      },
    );
  const rename = (id: string) =>
    act(
      () => renameTripSnapshot(tripId, id, { name: draftName }),
      (renamed) => setSnapshots((list) => (list ?? []).map((s) => (s.id === id ? renamed : s))),
    );
  const remove = (id: string) =>
    act(
      () => deleteTripSnapshot(tripId, id),
      () => setSnapshots((list) => (list ?? []).filter((s) => s.id !== id)),
    );
  const restore = (snapshot: TripSnapshot) =>
    act(
      () => restoreTripSnapshot(tripId, snapshot.id),
      (outcome) => {
        if (previewSeq !== null) onExitPreview();
        onRestored(outcome);
      },
    );

  return (
    <section aria-label="Snapshots" className="flex flex-col gap-2 border-b border-hairline pb-2">
      <Text variant="muted" as="span" className="font-medium uppercase tracking-wide">
        Snapshots
      </Text>
      {canEdit && (
        <form
          className="flex items-end gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="min-w-0 flex-1">
            <FormField id="snapshot-name" label="Snapshot name">
              <Input
                id="snapshot-name"
                value={name}
                maxLength={SNAPSHOT_NAME_MAX}
                placeholder="Before the big change"
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={busy || working || name.trim() === ""}>
            Save snapshot
          </Button>
        </form>
      )}
      {error !== null && (
        <Text variant="muted" role="alert" className="text-danger-ink">
          {error}
        </Text>
      )}
      {snapshots.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-hairline p-0">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id} data-testid="snapshot" className="flex flex-col gap-1 py-1.5">
              {mode?.id === snapshot.id && mode.kind === "rename" ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void rename(snapshot.id);
                  }}
                >
                  <Input
                    aria-label={`New name for ${snapshot.name}`}
                    value={draftName}
                    maxLength={SNAPSHOT_NAME_MAX}
                    onChange={(event) => setDraftName(event.target.value)}
                  />
                  <Button type="submit" size="sm" variant="secondary" disabled={working || draftName.trim() === ""}>
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => (previewSeq === snapshot.seq ? onExitPreview() : onPreview(snapshot.seq))}
                    className={cn("min-w-0 flex-1 justify-start", previewSeq === snapshot.seq && "font-bold")}
                  >
                    <span className="truncate">{snapshot.name}</span>
                  </Button>
                  <DataText size="xs" className="shrink-0">
                    {formatTripDate(snapshot.createdAt.slice(0, 10))}
                  </DataText>
                </div>
              )}
              {canEdit && mode?.id === snapshot.id && mode.kind === "delete" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Text variant="muted" as="span">{`Delete “${snapshot.name}”? This cannot be undone.`}</Text>
                  <Button size="sm" variant="destructive" disabled={working} onClick={() => void remove(snapshot.id)}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                    Keep
                  </Button>
                </div>
              )}
              {canEdit && mode?.id !== snapshot.id && (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Restore ${snapshot.name}`}
                    disabled={busy || working}
                    onClick={() => void restore(snapshot)}
                  >
                    Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Rename ${snapshot.name}`}
                    onClick={() => {
                      setDraftName(snapshot.name);
                      setMode({ id: snapshot.id, kind: "rename" });
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${snapshot.name}`}
                    onClick={() => setMode({ id: snapshot.id, kind: "delete" })}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
