"use client";

import { useState } from "react";
import type { TripHistory } from "@tc/contracts";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { formatTripDate } from "@/lib/formatDate";

// Bounded page size for the History popover's entries list (#1): only the
// most recent PAGE_SIZE entries render up front, with a "Show older"
// affordance to reveal more in PAGE_SIZE steps. Paired with the popover
// content's `max-h-80 overflow-y-auto` (set by the caller), this keeps the
// list from growing the popover unboundedly on long-lived trips.
const PAGE_SIZE = 20;

// The entries list, meant to render as a Popover's content (design-system.md
// surface vocabulary — History is a Popover, not an inline Panel that pushes
// page content down, #13). The caller (TripHeader) owns the Popover's
// open/trigger; this component is just the list + preview banner.
export function HistoryPanel({
  history,
  previewSeq,
  readOnly = false,
  onPreview,
  onExitPreview,
  onRevert,
}: {
  history: TripHistory | null;
  previewSeq: number | null;
  // Viewing a past version is a read and stays open to everyone who can open
  // the trip. Reverting to one is a write, so a viewer is not offered it
  // (M11 link 3, found on PR #71). Defaulted so existing call sites are
  // unchanged.
  readOnly?: boolean;
  onPreview: (seq: number) => void;
  onExitPreview: () => void;
  onRevert: (toSeq: number) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  if (history === null) return null;

  const visible = history.entries.slice(0, visibleCount);
  const hasMore = history.entries.length > visibleCount;

  return (
    <div className="flex flex-col gap-2">
      <ol reversed className="m-0 max-h-80 list-none divide-y divide-hairline overflow-y-auto p-0">
        {visible.map((entry) => (
          <li
            key={entry.batchId}
            data-testid="history-entry"
            className={cn("flex items-center justify-between gap-2 py-1.5", previewSeq === entry.toSeq && "bg-brand-tint")}
          >
            {/* min-w-0 + truncate so a long description ellipsizes instead of
                pushing the date past the popover's right edge (#17). */}
            <Button
              variant="ghost"
              onClick={() => (previewSeq === entry.toSeq ? onExitPreview() : onPreview(entry.toSeq))}
              className={cn("min-w-0 flex-1 justify-start", entry.undone && "opacity-50", previewSeq === entry.toSeq && "font-bold")}
            >
              <span className="truncate">{entry.undone ? <s>{entry.description}</s> : entry.description}</span>
            </Button>
            <DataText size="xs" className="shrink-0">{formatTripDate(entry.occurredAt.slice(0, 10))}</DataText>
          </li>
        ))}
      </ol>
      {hasMore && (
        <Button variant="ghost" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
          Show older
        </Button>
      )}
      {/* Actions sit under the text and wrap, rather than in Banner's no-wrap
          `actions` row that overflowed the narrow popover (comment #16, part
          one). "Dismiss" replaces the unobvious "Back to now" (part two). */}
      {previewSeq !== null && (
        <Banner variant="info">
          <div className="flex flex-col gap-1.5">
            <Text as="span">Viewing version {previewSeq} (read-only)</Text>
            <div className="flex flex-wrap gap-1.5">
              {!readOnly && (
                <Button variant="secondary" size="sm" onClick={() => onRevert(previewSeq)}>Revert to here</Button>
              )}
              <Button variant="ghost" size="sm" onClick={onExitPreview}>Dismiss</Button>
            </div>
          </div>
        </Banner>
      )}
    </div>
  );
}
