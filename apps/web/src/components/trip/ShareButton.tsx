"use client";

import { useCallback, useEffect, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import type { TripShare } from "@tc/contracts";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  size,
}: {
  tripId: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  // Same reason `variant` is here: the third call site (SettingsSheet's "Who
  // is invited" heading, where Share moved so a phone still has one — see
  // TripHeader) sits in a dense sheet whose every other control is `sm`, and
  // a default `md` trigger next to TravelersPanel's own buttons reads as a
  // different class of thing. Undefined leaves Button's own default, so the
  // header and the home hero are untouched.
  size?: VariantProps<typeof buttonVariants>["size"];
}) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<TripShare[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Same reasoning as TravelersPanel's: a `title` tooltip is not a delivery
  // mechanism, and copying IS how a share link is sent (CodeRabbit, PR #70).
  const [revealed, setRevealed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchTripShares(tripId);
    if (result.ok) {
      setShares(result.value);
      // A retry that worked must not leave the previous failure on screen
      // beside fresh, correct data.
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, [tripId]);

  // Only once the popover is opened: the home grid mounts this next to a trip
  // card, and a list fetch per render there would be a request nobody asked
  // for on a page that is mostly not about sharing.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function copy(share: TripShare) {
    const link = shareLink(share.token);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(share.shareId);
      setRevealed(null);
    } catch {
      // Not worth a red banner, but it does need a way out — so the link is
      // shown as selectable text rather than only living in a tooltip.
      setCopied(null);
      setRevealed(link);
    }
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    // Released in `finally`, AFTER the copy and the reload. Clearing it when
    // the POST returned left a window in which a second click minted a second
    // link while the first refresh was still in flight.
    try {
      const result = await createTripShare(tripId);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await copy(result.value);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(share: TripShare) {
    setBusy(true);
    try {
      const result = await revokeTripShare(tripId, share.shareId);
      // Reload FIRST, then report this action's own failure — `load()` clears
      // the error on success, so setting it beforehand would have this handler
      // wipe its own message and a failed revoke would look like a success.
      await load();
      if (!result.ok) setError(result.error.message);
    } finally {
      setBusy(false);
    }
  }

  const live = (shares ?? []).filter((s) => s.revokedAt === null);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      // 24rem, but never wider than the viewport allows. The e2e `narrow`
      // project runs at 1100px and the responsive spec goes down to 320px,
      // where a fixed 384px overlay would clip its own controls off-screen.
      contentClassName="w-96 max-w-[calc(100vw-2rem)]"
      trigger={
        <Button type="button" variant={variant} size={size}>
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

        {revealed !== null && (
          <div className="flex flex-col gap-1">
            <Text as="span" className="text-xs text-slate">
              Couldn&apos;t reach your clipboard — copy this instead:
            </Text>
            <Input readOnly aria-label="Share link" value={revealed} onFocus={(e) => e.target.select()} />
          </div>
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
