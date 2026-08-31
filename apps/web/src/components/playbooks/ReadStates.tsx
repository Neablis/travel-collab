"use client";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import type { LibraryRead } from "./useLibraryRead";

// The two banners project rule 6 makes every public-library route carry, in one
// place so the four routes say the same thing in the same words.

/**
 * The sync-failure state, with a Retry that is a real control rather than a
 * suggestion to reload the page.
 *
 * `variant="warning"`, not `danger`: the page below is usually still showing
 * something true (the read hook deliberately leaves stale data on screen), and
 * a red bar over correct-but-old content overstates what happened.
 */
export function SyncFailure({ read, what }: { read: Pick<LibraryRead<unknown>, "error" | "loading" | "reload">; what: string }) {
  if (read.error === null) return null;
  return (
    <Banner
      variant="warning"
      data-testid="library-sync-failure"
      actions={
        <Button variant="secondary" size="sm" disabled={read.loading} onClick={read.reload}>
          {read.loading ? "Retrying…" : "Retry"}
        </Button>
      }
    >
      Could not reach {what}. What is shown may be out of date.
    </Banner>
  );
}

/**
 * The conflict state: the library moved while this page was open.
 *
 * A line, never a modal and never a refusal — conflicts are data (invariant 3).
 * The new data is already on screen; this only says that it is new, and lets
 * the reader put the line away.
 */
export function LibraryMoved({ read, children }: { read: Pick<LibraryRead<unknown>, "changed" | "acknowledgeChange">; children: React.ReactNode }) {
  if (!read.changed) return null;
  return (
    <Banner
      variant="info"
      data-testid="library-moved"
      actions={
        <Button variant="ghost" size="sm" onClick={read.acknowledgeChange}>
          Got it
        </Button>
      }
    >
      {children}
    </Banner>
  );
}
