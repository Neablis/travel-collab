"use client";
import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { Page, ResetPageResult } from "@tc/contracts";
import { seedTemplateOf } from "@tc/pages";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Popover } from "@/components/ui/popover";
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
 *
 * Rendered as the notebook's `⋯` menu with this as its one item, so the menu
 * and its trigger share the item's visibility: when this renders nothing, there
 * is no empty `⋯` left behind.
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
  const [menuOpen, setMenuOpen] = useState(false);
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
  // The menu's only item is this one, so the whole menu — trigger included —
  // goes when the item would. An `⋯` that opens onto nothing is a control that
  // lies about having something behind it.
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
      {/* Mitchell, PR #269 preview: *"reset to default shouldnt be so
          prominent but not sure where a better place to put it is"*. It went
          behind a `⋯` — the overflow shape Home's trip cards already use for
          Duplicate and Delete — because a reset is rare and wipes a notebook's
          words, and a secondary button beside "Edit page" gave it the same
          weight as the thing a reader does every visit. `AccountMenu`'s shape
          below: ghost rows in a narrow popover, and the menu closes before the
          confirmation opens, so the dialog is never stacked over a popover.

          No `aria-haspopup="menu"` and no `menuitem` rows, for the reason
          `NotebooksMenu` gives: Radix's Popover is dialog semantics, and a
          menu role would promise arrow-key behaviour this does not have. */}
      <Popover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        align="end"
        contentClassName="w-48 p-1"
        trigger={
          // `size="icon"` is 32px on a desktop; Button's base lifts it to the
          // 44px floor on a phone (SPEC §13.1), like every icon control here.
          <Button variant="ghost" size="icon" aria-label="More notebook actions" title="More notebook actions">
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        }
      >
        <Button
          variant="ghost"
          className="h-auto w-full justify-start rounded-md px-2.5 py-2 text-sm font-normal text-ink"
          onClick={() => {
            setMenuOpen(false);
            setError(null);
            setOpen(true);
          }}
        >
          Reset to default
        </Button>
      </Popover>
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
