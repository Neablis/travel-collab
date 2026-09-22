import type { HistoryEntry } from "@tc/contracts";

/**
 * A history row: one batch, or a run of edits to one page shown as one line.
 *
 * `entry` is the NEWEST batch in the run, so previewing or reverting from this
 * row lands after the whole run rather than in the middle of somebody's
 * sentence. `count` is how many batches it stands for — 1 for everything that
 * was not grouped.
 */
export type HistoryRow = { entry: HistoryEntry; count: number };

/**
 * Collapse consecutive edits to the same page by the same person into one row.
 *
 * **Why this exists.** The notebook editor autosaves on an 800ms debounce, and
 * since notebook edits became real events (2026-09-22) each of those saves is
 * a batch. A few minutes of writing is dozens of identical-looking rows, and a
 * history you have to scroll past is a history nobody reads.
 *
 * **Presentation only, and that is the point.** Mitchell chose this shape over
 * one-event-per-session: the log keeps every batch, so undo stays as
 * fine-grained as it ever was and `deriveUndoRedo`'s bookkeeping is untouched.
 * Only the reading of it is grouped.
 *
 * The consequence worth stating, because it is a real trade and it was
 * accepted knowingly: **one undo does not undo one visible row.** A row
 * standing for twelve saves is undone twelve times. The count is rendered so
 * that is visible rather than surprising.
 *
 * Grouping is by `(pageId, actorId)` and only for ADJACENT entries:
 * - `pageId` is absent on every trip change and on any batch touching more
 *   than one page, so those never group — the rule needs no exception list.
 * - `actorId` keeps two people's work apart, so "Alice edited, Bob edited,
 *   Alice edited" stays three rows and no edit is attributed to the wrong
 *   person.
 * - Adjacency keeps the timeline honest: a notebook edit, a day added, another
 *   notebook edit is three rows, because collapsing across the day would put
 *   the trip change inside a run it did not belong to.
 *
 * An UNDONE entry never groups with anything, in either direction. A run drawn
 * with a strikethrough that is half undone would be a lie, and the two states
 * cannot share one row.
 */
export function coalesceHistory(entries: readonly HistoryEntry[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const entry of entries) {
    const previous = rows[rows.length - 1];
    const groupable =
      previous !== undefined &&
      entry.pageId !== undefined &&
      previous.entry.pageId === entry.pageId &&
      previous.entry.actorId === entry.actorId &&
      previous.entry.undone === false &&
      entry.undone === false;
    if (groupable) {
      previous.count += 1;
      continue;
    }
    rows.push({ entry, count: 1 });
  }
  return rows;
}
