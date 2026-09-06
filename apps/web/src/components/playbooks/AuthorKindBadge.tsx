import type { SavedDayAuthorKind } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";

/**
 * The one place a day's `authorKind` becomes something a person reads.
 *
 * **Only `"ai"` renders.** A badge on every human-written day would be a badge
 * on almost the whole library — a mark that is on everything marks nothing —
 * and, more importantly, "human" is the ABSENCE of a claim rather than a claim:
 * it is what `fromRow` falls back to when it cannot read the column, and what
 * every route except the content importer writes without being asked. Rendering
 * it would turn a default into an assertion.
 *
 * The wording is "AI starter", not "AI generated": these days are seeded
 * content the library ships with so a fresh account meets something worth
 * taking, and what a reader wants to know is *this was written to get you
 * started, not kept by somebody who went*. The distinction matters most
 * precisely where it sits — next to days that WERE kept by somebody who went.
 */
export function AuthorKindBadge({ authorKind }: { authorKind: SavedDayAuthorKind }) {
  if (authorKind !== "ai") return null;
  return (
    <Badge variant="info" title="Written as starter content, not kept out of somebody's own trip">
      AI starter
    </Badge>
  );
}
