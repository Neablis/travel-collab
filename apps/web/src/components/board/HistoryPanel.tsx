"use client";

import { useState } from "react";
import type { TripHistory } from "@tc/contracts";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { coalesceHistory } from "./coalesceHistory";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { formatTripDate } from "@/lib/formatDate";
import { AuthorChip, useAuthorNames } from "./SuggestionActions";

// "Suggested" alone until the names land: a name guessed wrong, or "a former
// traveler" said of a member, is worse than none.
function suggestedBy(name: string | null): string {
  return name === null ? "Suggested" : `Suggested by ${name}`;
}

// M40 D3: an accept-all reads "Accepted 7 suggestions / from Sam and Ana".
// The domain's description is the count; the names are only here, on the
// second line for the reason W11's by-line is (on one line the sentence ran
// 69px past the popover in the e2e walk). Null until every name lands, for
// `suggestedBy`'s reason. Deduplicated: two authors who have both left are
// each "a former traveler", and saying it twice reads as a stutter.
const AND = new Intl.ListFormat("en", { type: "conjunction" });
/**
 * The second line of an accept-all History row, "from Sam and Ana", each name
 * once; null while any name is still loading.
 */
export function fromAuthors(names: readonly (string | null)[]): string | null {
  if (names.some((n) => n === null)) return null;
  return `from ${AND.format([...new Set(names as string[])])}`;
}

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
  // Null names outside a `PeopleProvider` (TripHeader mounts one) or before
  // it lands.
  const nameOf = useAuthorNames(
    history?.entries.flatMap((e) =>
      e.origin.kind === "suggestion" ? [e.origin.authorId] : e.origin.kind === "suggestions" ? e.origin.authorIds : [],
    ) ?? [],
  );

  if (history === null) return null;

  // Grouped BEFORE paging, so "Show older" reveals another PAGE_SIZE rows a
  // reader can count rather than another PAGE_SIZE batches that might collapse
  // into three lines.
  const rows = coalesceHistory(history.entries);
  const visible = rows.slice(0, visibleCount);
  const hasMore = rows.length > visibleCount;

  return (
    <div className="flex flex-col gap-2">
      <ol reversed className="m-0 max-h-80 list-none divide-y divide-hairline overflow-y-auto p-0">
        {visible.map(({ entry, count }) => (
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
              className={cn(
                "min-w-0 flex-1 justify-start",
                // `h-auto` because a suggestion row is two lines and `md`'s
                // fixed `h-9` would clip the second; the base's phone floor
                // still holds, being `min-h`.
                (entry.origin.kind === "suggestion" || entry.origin.kind === "suggestions") && "h-auto py-1",
                entry.undone && "opacity-50",
                previewSeq === entry.toSeq && "font-bold",
              )}
            >
              {/* W11: an accepted suggestion's actor is the reviewer, so the
                  person who asked for it is said here, from `origin` — on a
                  line of its own. Beside the description it took the width,
                  and the row read `Moved "St…` (PR #311's preview walk). */}
              <span className="flex min-w-0 flex-col items-start text-left">
                <span data-testid="history-entry-description" className="max-w-full truncate">
                  {entry.undone ? <s>{entry.description}</s> : entry.description}
                </span>
                {entry.origin.kind === "suggestion" && (
                  <span className="flex max-w-full min-w-0 items-center gap-1.5 text-xs text-slate">
                    <AuthorChip authorId={entry.origin.authorId} />
                    <span className="truncate">{suggestedBy(nameOf(entry.origin.authorId))}</span>
                  </span>
                )}
                {entry.origin.kind === "suggestions" && (
                  <AuthorsLine names={entry.origin.authorIds.map(nameOf)} />
                )}
              </span>
              {/* The count is shown rather than implied, because one undo
                  undoes one BATCH and this row stands for `count` of them —
                  see `coalesceHistory`. A reader who cannot see the number
                  would have no way to know why undo did not clear the line. */}
              {count > 1 && (
                <DataText size="xs" className="shrink-0 opacity-60">{`×${count}`}</DataText>
              )}
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

// An accept-all's second line; nothing until every name has landed.
function AuthorsLine({ names }: { names: readonly (string | null)[] }) {
  const from = fromAuthors(names);
  return from === null ? null : <span className="max-w-full truncate text-xs text-slate">{from}</span>;
}
