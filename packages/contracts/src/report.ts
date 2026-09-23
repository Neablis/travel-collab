import { z } from "zod";
import { boundedNote } from "./review.ts";

// Reporting and moderation (M12 link 6) — the trust-and-safety scope
// quarantined here since 2026-07-28, while M11a's invite gate bounded who could
// publish. Ordinary CRUD (`content_reports`), not events: a report is about the
// library, not about any trip's plan.

export const ReportReason = z.enum(["spam", "offensive", "unsafe", "inaccurate", "other"]);
export type ReportReason = z.infer<typeof ReportReason>;

/** `open` until an operator acts; `actioned` hid something, `dismissed` did not. */
export const ReportStatus = z.enum(["open", "actioned", "dismissed"]);
export type ReportStatus = z.infer<typeof ReportStatus>;

/**
 * What is being reported. A review has no id of its own — its key is (day,
 * reviewer), the same composite `saved_day_reviews` is keyed on — so a review
 * target names both.
 */
export const ReportTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved_day"), savedDayId: z.string().uuid() }),
  z.object({ kind: z.literal("review"), savedDayId: z.string().uuid(), reviewerId: z.string().min(1) }),
]);
export type ReportTarget = z.infer<typeof ReportTarget>;
export type ReportTargetKind = ReportTarget["kind"];

export const REPORT_NOTE_MAX = 500;

export const CreateReportInput = z.object({
  target: ReportTarget,
  reason: ReportReason,
  note: boundedNote(REPORT_NOTE_MAX).default(null),
});
export type CreateReportInput = z.infer<typeof CreateReportInput>;

export const ContentReport = z.object({
  reportId: z.string().uuid(),
  target: ReportTarget,
  reporterId: z.string().min(1),
  reason: ReportReason,
  note: z.string().nullable(),
  status: ReportStatus,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  resolutionNote: z.string().nullable(),
});
export type ContentReport = z.infer<typeof ContentReport>;

/**
 * What an operator can do from the queue. Hiding and restoring are separate
 * actions rather than a toggle so a double-submit cannot undo itself.
 *
 * `hide-day`'s note becomes `saved_days.moderation_note` — the one line the
 * author's copy can show about why it left the library.
 */
export const AdminReportAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("hide-day"), note: boundedNote(REPORT_NOTE_MAX).optional() }),
  z.object({ action: z.literal("hide-review") }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("restore-day") }),
  z.object({ action: z.literal("restore-review") }),
]);
export type AdminReportAction = z.infer<typeof AdminReportAction>;
