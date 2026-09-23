"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { REPORT_NOTE_MAX, type AdminReportAction, type ReportReason } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { displayNameFor } from "@/lib/displayName";
import { formatInstantLong } from "@/lib/formatDate";
import type { AdminReportQueueItem } from "@/lib/reports";

const REASON_LABEL: Record<ReportReason, string> = {
  spam: "Spam",
  offensive: "Offensive",
  unsafe: "Unsafe",
  inaccurate: "Inaccurate",
  other: "Other",
};

const nameOf = (userId: string) => displayNameFor({ userId });
const when = (iso: string) => formatInstantLong(iso) ?? iso;

/**
 * One report in the operator's queue, with the actions its target's current
 * state allows. `onAct` resolves to a refusal to show inline, or null.
 */
export function ReportRow({
  item,
  onAct,
}: {
  item: AdminReportQueueItem;
  onAct: (action: AdminReportAction) => Promise<string | null>;
}) {
  const { report, day, review, reportsOnTarget } = item;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState("");
  const noteId = useId();

  // **Every button on the row is disabled while one action is in flight.**
  // Hide and restore are separate actions so a double-submit cannot undo
  // itself, but a second `hide-day` would still overwrite the note the first
  // wrote, and a Dismiss racing a Hide would settle the same reports twice.
  // `setBusy` runs before the first `await`, so React commits it at the end of
  // the click that caused it — the second click already meets `disabled`.
  async function run(action: AdminReportAction) {
    setBusy(true);
    setError(null);
    const refusal = await onAct(action);
    setBusy(false);
    if (refusal === null) setComposing(false);
    else setError(refusal);
  }

  const isDay = report.target.kind === "saved_day";
  const open = report.status === "open";
  // What each action needs to be true of the target NOW. A gone target offers
  // only Dismiss: the server refuses to action something that no longer
  // exists, since "actioned" would record a hide that hid nothing.
  const canHideDay = isDay && day !== null && day.moderatedAt === null;
  const canRestoreDay = isDay && day?.moderatedAt != null;
  const canHideReview = !isDay && review !== null && review.hiddenAt === null;
  const canRestoreReview = !isDay && review?.hiddenAt != null;

  return (
    <li data-testid={`report-${report.reportId}`} className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{isDay ? "Day" : "Review"}</Badge>
        {day === null ? (
          <Text as="span" className="text-sm text-danger-ink">
            This day no longer exists.
          </Text>
        ) : (
          <>
            <Link href={`/playbooks/day/${day.savedDayId}`} className="text-sm font-semibold text-ink underline">
              {day.name}
            </Link>
            <Text as="span" variant="secondary">
              by {day.ownerDisplayName}
            </Text>
          </>
        )}
        <Badge variant={reportsOnTarget > 1 ? "warning" : "neutral"}>
          {reportsOnTarget === 1 ? "1 report on this" : `${reportsOnTarget} reports on this`}
        </Badge>
      </div>

      {!isDay &&
        (review === null ? (
          <Text as="span" className="text-sm text-danger-ink">
            This review no longer exists.
          </Text>
        ) : (
          <div className="flex flex-wrap items-baseline gap-2 text-sm">
            <span aria-label={`${review.stars} of 5 stars`} className="text-ink">
              {"★".repeat(review.stars)}
              {"☆".repeat(Math.max(0, 5 - review.stars))}
            </span>
            {review.note !== null && <span className="text-ink">“{review.note}”</span>}
            <Text as="span" variant="secondary">
              review by {nameOf(review.reviewerId)}
            </Text>
          </div>
        ))}

      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant="danger">{REASON_LABEL[report.reason]}</Badge>
        {report.note !== null && <span className="text-sm text-ink">“{report.note}”</span>}
        <Text as="span" variant="muted">
          Reported by {nameOf(report.reporterId)} on {when(report.createdAt)}
        </Text>
      </div>

      {day?.moderatedAt != null && (
        <Text as="span" variant="muted" className="text-warning-ink">
          Hidden from the library since {when(day.moderatedAt)}
          {day.moderationNote !== null && <> — note to the author: “{day.moderationNote}”</>}
        </Text>
      )}
      {review?.hiddenAt != null && (
        <Text as="span" variant="muted" className="text-warning-ink">
          Review hidden since {when(review.hiddenAt)}
        </Text>
      )}
      {!open && report.resolvedAt !== null && (
        <Text as="span" variant="muted">
          {report.status === "actioned" ? "Actioned" : "Dismissed"}
          {report.resolvedBy !== null && <> by {nameOf(report.resolvedBy)}</>} on {when(report.resolvedAt)}
        </Text>
      )}

      {composing ? (
        <div className="flex max-w-md flex-col gap-2">
          <FormField
            id={noteId}
            label="Note to the author (optional)"
            hint={`Shown to the author on their copy of the day, as the reason it left the library. Up to ${REPORT_NOTE_MAX} characters.`}
          >
            <Textarea
              id={noteId}
              maxLength={REPORT_NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              // Omitted rather than sent empty: the contract's note is
              // optional, and "no note" is the operator's answer, not "".
              onClick={() => void run(note.trim() === "" ? { action: "hide-day" } : { action: "hide-day", note: note.trim() })}
            >
              Hide it
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {canHideDay && (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setComposing(true)}>
              Hide from the library
            </Button>
          )}
          {canRestoreDay && (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void run({ action: "restore-day" })}>
              Restore to the library
            </Button>
          )}
          {canHideReview && (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void run({ action: "hide-review" })}>
              Hide review
            </Button>
          )}
          {canRestoreReview && (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void run({ action: "restore-review" })}>
              Restore review
            </Button>
          )}
          {/* Only while open: an actioned or dismissed report is decided, and
              the server would settle nothing by dismissing it again. */}
          {open && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run({ action: "dismiss" })}>
              Dismiss
            </Button>
          )}
        </div>
      )}

      {error !== null && (
        <Text as="span" role="status" className="text-xs text-danger-ink">
          {error}
        </Text>
      )}
    </li>
  );
}
