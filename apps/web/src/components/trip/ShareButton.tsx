"use client";

import { useCallback, useEffect, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import type { TripShare } from "@tc/contracts";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import {
  createTripShare,
  fetchTripShares,
  revokeTripShare,
  shareLink,
} from "@/lib/apiClient";

// Real as of M11 link 4 — this was `<Preview id="share-button">`, an inert
// control with no onClick, at two call sites (TripHeader's action cluster and
// the home hero). Both still mount the same component with the same `variant`;
// what changed is that it now does something.
//
// What it does is the milestone's second user story, exactly: a link pinned to
// the trip's history point at the moment it was created. Keep planning
// afterwards and the link still shows the trip as it was — which is why each
// row says which change it is pinned to, and why re-pinning is a NEW link
// rather than an edit to an existing one (ADR-027).

function pinLabel(share: TripShare): string {
  return `Pinned at change ${share.seq}`;
}

export function ShareButton({
  tripId,
  variant = "ghost",
}: {
  tripId: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
}) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<TripShare[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchTripShares(tripId);
    if (result.ok) setShares(result.value);
    else setError(result.error.message);
  }, [tripId]);

  // Only once the popover is opened: the home grid mounts this next to a trip
  // card, and a list fetch per render there would be a request nobody asked
  // for on a page that is mostly not about sharing.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function copy(share: TripShare) {
    try {
      await navigator.clipboard.writeText(shareLink(share.token));
      setCopied(share.shareId);
    } catch {
      // A denied clipboard permission is not worth an error: the link is on
      // the button's `title` and still works.
      setCopied(null);
    }
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    const result = await createTripShare(tripId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await copy(result.value);
    await load();
  }

  async function handleRevoke(share: TripShare) {
    setBusy(true);
    const result = await revokeTripShare(tripId, share.shareId);
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    await load();
  }

  const live = (shares ?? []).filter((s) => s.revokedAt === null);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      contentClassName="w-96"
      trigger={
        <Button type="button" variant={variant}>
          Share
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="share-panel">
        <Text as="span" className="text-xs text-slate">
          A share link shows this trip as it is right now. Keep planning
          afterwards and the link still shows what you shared.
        </Text>

        <Button variant="primary" size="sm" disabled={busy} onClick={() => void handleCreate()}>
          Create a share link
        </Button>

        {live.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
            {live.map((share) => (
              <div key={share.shareId} className="flex items-center justify-between gap-2">
                <Text as="span" className="min-w-0 flex-1 truncate text-xs text-ink">
                  {pinLabel(share)}
                </Text>
                {/* Same stable-accessible-name / changing-label split the
                    invite list uses: creating a link copies it immediately,
                    so a name taken from the label would differ per row. */}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Copy share link"
                  title={shareLink(share.token)}
                  onClick={() => void copy(share)}
                >
                  {copied === share.shareId ? "Copied" : "Copy link"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Turn off share link"
                  disabled={busy}
                  onClick={() => void handleRevoke(share)}
                >
                  Turn off
                </Button>
              </div>
            ))}
          </div>
        )}

        {shares !== null && live.length === 0 && (
          <Text as="span" className="text-xs text-slate">
            No share links yet.
          </Text>
        )}

        {error !== null && (
          <Text as="span" className="text-xs text-danger-ink">
            {error}
          </Text>
        )}
      </div>
    </Popover>
  );
}
