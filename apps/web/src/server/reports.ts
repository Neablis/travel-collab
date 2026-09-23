import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type {
  AdminReportAction,
  ContentReport,
  CreateReportInput,
  ReportStatus,
  ReportTarget,
} from "@tc/contracts";
import type { AdminReportQueueItem } from "@/lib/reports";
import { displayNameFor } from "@/lib/displayName";
import { db, type Queryable } from "./db/client";
import { contentReports, savedDayReviews, savedDays } from "./db/schema";
import { isUuid } from "./ids";
import { lockSavedDayForReviewWrite, recomputeReviewCounters } from "./reviews";
import { readableSavedDay } from "./savedDays";

// Reports and the operator's queue over them (M12 link 6, D5/D6). Ordinary
// CRUD, like the reviews: nothing here is trip state, and nothing here enters
// the event log.
//
// **This module is the only writer of `saved_days.moderated_at` and
// `saved_day_reviews.hidden_at`.** What a moderated day disappears FROM is not
// decided here — that is the `notModerated` filter in `playbooks.ts`,
// `cities.ts` and `readableSavedDay`, listed in the schema's `moderatedAt`
// note. This module only moves the columns — including putting them back after
// a content re-import rewrites the row (`carryModeration`).

type ReportRow = typeof contentReports.$inferSelect;

export type ReportRefusal = {
  code: "not-found" | "own-content" | "action-mismatch";
  message: string;
};
export type ReportResult<T> = { ok: true; value: T } | { ok: false; error: ReportRefusal };

function targetOf(row: ReportRow): ReportTarget {
  return row.targetKind === "review"
    ? { kind: "review", savedDayId: row.savedDayId, reviewerId: row.reviewAuthorId! }
    : { kind: "saved_day", savedDayId: row.savedDayId };
}

function toDto(row: ReportRow): ContentReport {
  return {
    reportId: row.id,
    target: targetOf(row),
    reporterId: row.reporterId,
    reason: row.reason,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
    resolutionNote: row.resolutionNote,
  };
}

/**
 * The WHERE clause naming every report on one target — the unit an operator
 * decides about, and the unit `reportsOnTarget` counts.
 *
 * A day target's `review_author_id` is null, and `=` never matches null — so
 * it is `is null` there, the same reason the unique constraint is NULLS NOT
 * DISTINCT.
 */
function sameTarget(target: ReportTarget) {
  return and(
    eq(contentReports.targetKind, target.kind),
    eq(contentReports.savedDayId, target.savedDayId),
    target.kind === "review"
      ? eq(contentReports.reviewAuthorId, target.reviewerId)
      : isNull(contentReports.reviewAuthorId),
  );
}

const NOT_FOUND: ReportRefusal = { code: "not-found", message: "There is nothing to report there." };

/**
 * File a report, or find the one this person already filed.
 *
 * **What you cannot see, you cannot report — and cannot learn exists.** The
 * day is read through `readableSavedDay`, so somebody else's private day, a
 * deleted one and a moderated one all answer `not-found`: the same answer
 * `requireSavedDayRead` gives, for the reason `saved-day-access.ts` records. A
 * review target additionally needs a visible review row; a hidden review is
 * already out of the library, and is `not-found` on the same terms.
 *
 * **Your own content is refused** (`own-content`): reporting yourself is not a
 * moderation signal, and a report the author filed would sit in the queue
 * looking like one. Checked only AFTER the read succeeded, so the 403 can never
 * confirm that an unreadable id exists.
 *
 * **A re-report is the report you already filed** (`created: false`), whatever
 * its status — the unique constraint makes it so, and the route answers 200
 * rather than 201. A dismissed report is not re-opened by filing it again: that
 * would let one person keep a decided target at the top of the queue.
 */
export async function createReport(
  reporterId: string,
  input: CreateReportInput,
  now: string = new Date().toISOString(),
): Promise<ReportResult<{ report: ContentReport; created: boolean }>> {
  const { target } = input;
  const day = await readableSavedDay(target.savedDayId, reporterId);
  if (day === null) return { ok: false, error: NOT_FOUND };

  if (target.kind === "saved_day") {
    if (day.ownerId === reporterId) {
      return { ok: false, error: { code: "own-content", message: "You cannot report your own day." } };
    }
  } else {
    const review = await db
      .select({ hiddenAt: savedDayReviews.hiddenAt })
      .from(savedDayReviews)
      .where(
        and(
          eq(savedDayReviews.savedDayId, target.savedDayId),
          eq(savedDayReviews.reviewerId, target.reviewerId),
        ),
      );
    if (review[0] === undefined) return { ok: false, error: NOT_FOUND };
    if (target.reviewerId === reporterId) {
      return { ok: false, error: { code: "own-content", message: "You cannot report your own review." } };
    }
    if (review[0].hiddenAt !== null) return { ok: false, error: NOT_FOUND };
  }

  const written = await db
    .insert(contentReports)
    .values({
      id: randomUUID(),
      targetKind: target.kind,
      savedDayId: target.savedDayId,
      reviewAuthorId: target.kind === "review" ? target.reviewerId : null,
      reporterId,
      reason: input.reason,
      note: input.note,
      status: "open",
      createdAt: new Date(now),
    })
    .onConflictDoNothing()
    .returning();
  if (written[0] !== undefined) return { ok: true, value: { report: toDto(written[0]), created: true } };

  const existing = await db
    .select()
    .from(contentReports)
    .where(and(eq(contentReports.reporterId, reporterId), sameTarget(target)));
  // The insert conflicted, so the row exists; nothing deletes reports.
  return { ok: true, value: { report: toDto(existing[0]!), created: false } };
}

/**
 * How many rows the queue returns. The population is invited and small; this
 * bounds a response, it is not a page size anyone navigates.
 */
const QUEUE_LIMIT = 200;

/**
 * The operator's queue: reports in one status, oldest first — the order the
 * `content_reports_status` index serves.
 *
 * Each row carries what the target IS (the day's name and owner, the review's
 * stars and note) and how many people reported it, because an operator
 * deciding from a reason code alone is deciding blind.
 */
export async function listReports(query: { status: ReportStatus }): Promise<AdminReportQueueItem[]> {
  const peers = sql<number>`(
    select count(*)::int from content_reports r2
    where r2.target_kind = ${contentReports.targetKind}
      and r2.saved_day_id = ${contentReports.savedDayId}
      and r2.review_author_id is not distinct from ${contentReports.reviewAuthorId}
  )`;
  const rows = await db
    .select({ report: contentReports, day: savedDays, review: savedDayReviews, peers })
    .from(contentReports)
    .leftJoin(savedDays, eq(savedDays.id, contentReports.savedDayId))
    .leftJoin(
      savedDayReviews,
      and(
        eq(savedDayReviews.savedDayId, contentReports.savedDayId),
        eq(savedDayReviews.reviewerId, contentReports.reviewAuthorId),
      ),
    )
    .where(eq(contentReports.status, query.status))
    .orderBy(asc(contentReports.createdAt), asc(contentReports.id))
    .limit(QUEUE_LIMIT);

  return rows.map(({ report, day, review, peers: count }) => ({
    report: toDto(report),
    day:
      day === null
        ? null
        : {
            savedDayId: day.id,
            name: day.name,
            ownerId: day.ownerId,
            ownerDisplayName: displayNameFor({ userId: day.ownerId }),
            visibility: day.visibility,
            moderatedAt: day.moderatedAt?.toISOString() ?? null,
            moderationNote: day.moderationNote,
          },
    review:
      review === null
        ? null
        : {
            reviewerId: review.reviewerId,
            stars: review.stars,
            note: review.note,
            hiddenAt: review.hiddenAt?.toISOString() ?? null,
          },
    reportsOnTarget: Number(count),
  }));
}

/** Which reports an action settles, and what it settles them as. */
function resolutionOf(action: AdminReportAction["action"]): ReportStatus {
  return action === "hide-day" || action === "hide-review" ? "actioned" : "dismissed";
}

/**
 * An operator acts on a report. One decision per TARGET, not per report: the
 * five people who reported the same day are answered by one action, so the
 * queue never holds a report about something already decided.
 *
 *   * `hide-day` sets `moderated_at` (kept, not re-stamped, if already set)
 *     and `moderation_note`, and resolves every open report on that day as
 *     `actioned`. Valid from a review report too — the operator may decide the
 *     day itself is the problem — in which case that report is resolved with
 *     the day's.
 *   * `hide-review` sets `hidden_at` and recomputes the day's counters; review
 *     targets only.
 *   * `dismiss` resolves every open report on the target as `dismissed`.
 *   * `restore-day` / `restore-review` clear the flag. Reports already actioned
 *     keep their record of what happened; any still open on the target are
 *     dismissed, since the operator has just decided it stays.
 *
 * `restore-day` does NOT touch `visibility`, and `hide-day` does not either:
 * the author's publish state and the operator's decision are independent axes
 * (the schema's `moderatedAt` note), so neither can undo the other.
 */
export async function actOnReport(
  reportId: string,
  action: AdminReportAction,
  operatorId: string,
  now: string = new Date().toISOString(),
): Promise<ReportResult<ContentReport>> {
  if (!isUuid(reportId)) return { ok: false, error: { code: "not-found", message: "No such report." } };
  const at = new Date(now);

  return db.transaction(async (tx): Promise<ReportResult<ContentReport>> => {
    const found = await tx.select().from(contentReports).where(eq(contentReports.id, reportId)).for("update");
    const row = found[0];
    if (row === undefined) return { ok: false, error: { code: "not-found", message: "No such report." } };
    const target = targetOf(row);

    if ((action.action === "hide-review" || action.action === "restore-review") && target.kind !== "review") {
      return {
        ok: false,
        error: { code: "action-mismatch", message: "That report is about a day, not a review." },
      };
    }

    // How many rows the action moved: zero means the target is gone.
    let touched: number;
    switch (action.action) {
      case "hide-day":
        touched = await tx
          .update(savedDays)
          .set({
            moderatedAt: sql`coalesce(${savedDays.moderatedAt}, ${at})`,
            moderationNote: action.note ?? null,
          })
          .where(eq(savedDays.id, row.savedDayId))
          .returning({ id: savedDays.id })
          .then((r) => r.length);
        break;
      case "restore-day":
        touched = await tx
          .update(savedDays)
          .set({ moderatedAt: null, moderationNote: null })
          .where(eq(savedDays.id, row.savedDayId))
          .returning({ id: savedDays.id })
          .then((r) => r.length);
        break;
      case "hide-review":
      case "restore-review":
        // Lock BEFORE the flag write, not just before the recompute: under READ
        // COMMITTED a waiting UPDATE does not re-run its subquery, so a review
        // posted concurrently would be missing from the stored count
        // (`reviews.ts`, `lockSavedDayForReviewWrite`).
        await lockSavedDayForReviewWrite(tx, row.savedDayId);
        touched = await tx
          .update(savedDayReviews)
          .set({ hiddenAt: action.action === "hide-review" ? sql`coalesce(${savedDayReviews.hiddenAt}, ${at})` : null })
          .where(
            and(
              eq(savedDayReviews.savedDayId, row.savedDayId),
              eq(savedDayReviews.reviewerId, row.reviewAuthorId!),
            ),
          )
          .returning({ savedDayId: savedDayReviews.savedDayId })
          .then((r) => r.length);
        if (touched > 0) await recomputeReviewCounters(tx, row.savedDayId);
        break;
      case "dismiss":
        touched = 1;
        break;
    }
    // The thing the report names is gone (no foreign keys, ADR-025). Refused
    // rather than resolved: "actioned" would record a hide that hid nothing.
    if (touched === 0) {
      return { ok: false, error: { code: "not-found", message: "What this report names no longer exists." } };
    }

    // `hide-day` settles the day's reports; every other action settles the
    // reports on the target this one names. This report is always included,
    // so a day hidden from a review report does not leave that report open.
    const settles =
      action.action === "hide-day" || action.action === "restore-day"
        ? sameTarget({ kind: "saved_day", savedDayId: row.savedDayId })
        : sameTarget(target);
    const openOnTarget = await tx
      .select({ id: contentReports.id })
      .from(contentReports)
      .where(and(settles, eq(contentReports.status, "open")));
    const ids = [...new Set([...openOnTarget.map((r) => r.id), ...(row.status === "open" ? [row.id] : [])])];
    if (ids.length > 0) {
      await tx
        .update(contentReports)
        .set({ status: resolutionOf(action.action), resolvedAt: at, resolvedBy: operatorId })
        .where(inArray(contentReports.id, ids));
    }

    const after = await tx.select().from(contentReports).where(eq(contentReports.id, reportId));
    return { ok: true, value: toDto(after[0]!) };
  });
}

/** A day's moderation state as `carryModeration` saw it before a rewrite. */
type CarriedModeration = { id: string; moderatedAt: Date; moderationNote: string | null }[];

// The content importers (the production script and both dev seed routes)
// rewrite a day by DELETE + INSERT through `newSavedDayRow`, which writes a
// fresh row with no moderation on it. Without this, re-importing a bundle
// would silently republish every day an operator had hidden — the reviews
// already survive that rewrite (`recomputeReviewCounters`), and a moderator's
// decision is no less a person's than a reviewer's stars.
/**
 * Read the moderation of every hidden day among `ids`, BEFORE the caller
 * deletes them; hand the result to `restoreModeration` after the re-insert,
 * in the same transaction.
 */
export async function carryModeration(tx: Queryable, ids: string[]): Promise<CarriedModeration> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: savedDays.id, moderatedAt: savedDays.moderatedAt, moderationNote: savedDays.moderationNote })
    .from(savedDays)
    .where(and(inArray(savedDays.id, ids), isNotNull(savedDays.moderatedAt)));
  return rows.map((r) => ({ id: r.id, moderatedAt: r.moderatedAt!, moderationNote: r.moderationNote }));
}

/**
 * Put back what `carryModeration` read, onto the rewritten rows. A day the
 * rewrite did not re-create stays gone — there is nothing left to hide.
 */
export async function restoreModeration(tx: Queryable, carried: CarriedModeration): Promise<void> {
  for (const { id, moderatedAt, moderationNote } of carried) {
    await tx.update(savedDays).set({ moderatedAt, moderationNote }).where(eq(savedDays.id, id));
  }
}
