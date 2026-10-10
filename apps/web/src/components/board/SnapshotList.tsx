"use client";

import { useEffect, useRef, useState } from "react";
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
import { formatInstantDateTime } from "@/lib/formatDate";

// Which row is mid-rename or mid-delete. One at a time: a second row's control
// replaces the first's rather than stacking two inline forms in a popover.
type RowMode = { id: string; kind: "rename" | "delete" } | null;

// A refusal the list can act on: the snapshot is gone (another editor deleted
// it), so the row goes too rather than offering controls that cannot work.
type Refusal = { message: string; code?: string };

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
  // The inline rename and delete-confirm replace the row's own Rename and
  // Delete buttons, so closing one would drop focus to <body>. Each trigger is
  // kept here by `<id>:<kind>`, and focus goes back to the one that opened it;
  // when that row is gone (deleted), to the name field.
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const nameField = useRef<HTMLInputElement>(null);
  const returnTo = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== null || returnTo.current === null) return;
    (triggers.current.get(returnTo.current) ?? nameField.current)?.focus();
    returnTo.current = null;
  }, [mode, snapshots]);

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

  // Saving takes the server's head, never the version on screen, so the form
  // is closed while an old one is previewed rather than read as "save this".
  const previewing = previewSeq !== null;
  const keep = (key: string, el: HTMLButtonElement | null) => {
    if (el) triggers.current.set(key, el);
    else triggers.current.delete(key);
  };

  const close = () => {
    if (mode !== null) returnTo.current = `${mode.id}:${mode.kind}`;
    setMode(null);
  };
  const drop = (id: string) => setSnapshots((list) => (list ?? []).filter((s) => s.id !== id));

  // Every write goes through here: one at a time, and the server's refusal
  // (the cap's reason above all) is what the reader is told.
  async function act<T>(
    run: () => Promise<{ ok: true; value: T } | { ok: false; error: Refusal }>,
    then: (value: T) => void,
    about?: string,
  ) {
    setWorking(true);
    setError(null);
    const result = await run();
    setWorking(false);
    if (!result.ok) {
      setError(result.error.message);
      if (about !== undefined && result.error.code === "not-found") {
        close();
        drop(about);
      }
      return;
    }
    close();
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
      id,
    );
  const remove = (id: string) =>
    act(
      () => deleteTripSnapshot(tripId, id),
      () => drop(id),
      id,
    );
  const restore = (snapshot: TripSnapshot) =>
    act(
      () => restoreTripSnapshot(tripId, snapshot.id),
      (outcome) => {
        if (previewSeq !== null) onExitPreview();
        onRestored(outcome);
      },
      snapshot.id,
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
                ref={nameField}
                id="snapshot-name"
                value={name}
                maxLength={SNAPSHOT_NAME_MAX}
                placeholder="Before the big change"
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
          </div>
          {/* `md`, the `Input`'s own `h-9` (both lift to the 44px floor on a
              phone), so the two sit as one row on `items-end` — Mitchell,
              trip preview: *"Save snapshot button should be same size as
              input to left"*. `sm` was a 28px button beside a 36px field. */}
          <Button
            type="submit"
            variant="secondary"
            size="md"
            disabled={busy || working || previewing || name.trim() === ""}
          >
            Save snapshot
          </Button>
        </form>
      )}
      {canEdit && previewing && (
        <Text variant="muted">A snapshot saves the trip as it is now, not the version you are viewing.</Text>
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
                    autoFocus
                    aria-label={`New name for ${snapshot.name}`}
                    value={draftName}
                    maxLength={SNAPSHOT_NAME_MAX}
                    onChange={(event) => setDraftName(event.target.value)}
                  />
                  <Button type="submit" size="sm" variant="secondary" disabled={working || draftName.trim() === ""}>
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={close}>
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
                    {formatInstantDateTime(snapshot.createdAt)}
                  </DataText>
                </div>
              )}
              {canEdit && mode?.id === snapshot.id && mode.kind === "delete" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Text variant="muted" as="span">{`Delete “${snapshot.name}”? This cannot be undone.`}</Text>
                  <Button
                    autoFocus
                    size="sm"
                    variant="destructive"
                    disabled={working}
                    onClick={() => void remove(snapshot.id)}
                  >
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={close}>
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
                    ref={(el) => keep(`${snapshot.id}:rename`, el)}
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
                    ref={(el) => keep(`${snapshot.id}:delete`, el)}
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
