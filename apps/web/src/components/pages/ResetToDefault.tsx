"use client";
import { useEffect, useState } from "react";
import type { Page, ResetPageResult } from "@tc/contracts";
import { seedTemplateOf } from "@tc/pages";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { resetPageToDefault } from "@/lib/pagesClient";
import { fetchTripAccess } from "@/lib/apiClient";
import { cachedRead } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";

/**
 * *Reset to default* on an open notebook (Mitchell, 2026-09-27): puts back the
 * notebook's current template, title and all, after a confirmation. Renders
 * only for the trip's OWNER (*"Only trip owner"*), and only on a notebook that
 * came with the trip — one a person made has no default to go back to. The
 * server refuses anyone else regardless.
 *
 * Offered in Reading only, like *Save as template*, and for a sharper reason:
 * an open edit session has not reached the log yet (ADR-036), so a reset in
 * Editing would race the session's own commit of the words it just replaced.
 * The confirmation names the revision the owner is looking at, so a reset of a
 * notebook that has moved since is refused rather than wiping words unseen.
 */
export function ResetToDefault({
  tripId,
  page,
  onReset,
  revision = () => page.updatedAt,
}: {
  tripId: string;
  page: Page;
  onReset: (result: ResetPageResult) => void;
  /**
   * The revision the reader is looking at, read when the reset is confirmed.
   * A getter, because `PageScreen` learns a new one each time an edit session
   * commits without re-rendering this — `page.updatedAt` alone went stale
   * after the first edit, and the reset was refused as `page-changed` (found
   * by the e2e walk).
   */
  revision?: () => string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seeded = seedTemplateOf(page) !== undefined;
  // The role read `PageScreen`'s editor gate uses, through the same cache — and
  // only for a seed, so an ordinary notebook costs no request. A failed read is
  // no answer, so the control stays hidden.
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    if (!seeded) return;
    let cancelled = false;
    void cachedRead(tripKeys.access(tripId), () => fetchTripAccess(tripId)).then((access) => {
      if (!cancelled) setIsOwner(access.ok && access.value.myRole === "owner");
    });
    return () => {
      cancelled = true;
    };
  }, [seeded, tripId]);
  if (!seeded || !isOwner) return null;

  async function reset() {
    setBusy(true);
    const result = await resetPageToDefault(tripId, page.id, { expectedUpdatedAt: revision() });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    onReset(result.value);
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Reset to default
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Reset to default?">
        <div className="flex flex-col gap-3">
          <Text variant="secondary">
            This replaces everything in “{page.title}” with the notebook as it comes with a new trip. The current
            version stays in the trip&apos;s history, and you can undo the reset straight afterwards.
          </Text>
          {error !== null && (
            <Text as="span" role="alert" className="text-xs text-danger-ink">
              {error}
            </Text>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void reset()}>
            Reset notebook
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
