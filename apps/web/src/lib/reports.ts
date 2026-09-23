import { z } from "zod";
import { ContentReport, SavedDayVisibility } from "@tc/contracts";

// The response bodies of the reporting endpoints (M12 link 6): `POST
// /api/reports` and the operator's `/api/admin/reports`. The REQUEST shapes and
// the report itself are `packages/contracts` (`CreateReportInput`,
// `AdminReportAction`, `ContentReport`); these only wrap them, web-local for
// the reason `lib/playbooks.ts` gives, and promotable with it.

export const CreateReportResponse = z.object({ report: ContentReport });
export type CreateReportResponse = z.infer<typeof CreateReportResponse>;

/**
 * One row of the operator's queue: the report, and enough of what it is about
 * to decide without opening the day.
 *
 * `day` is null only when the row it names is gone — `content_reports` has no
 * foreign key (ADR-025's terms), so that is reachable, and the queue shows it
 * rather than dropping a report nobody resolved.
 */
export const AdminReportQueueItem = z.object({
  report: ContentReport,
  day: z
    .object({
      savedDayId: z.string().uuid(),
      name: z.string(),
      ownerId: z.string().min(1),
      ownerDisplayName: z.string(),
      visibility: SavedDayVisibility,
      moderatedAt: z.string().nullable(),
      moderationNote: z.string().nullable(),
    })
    .nullable(),
  /** Present for a review target whose row still exists. */
  review: z
    .object({
      reviewerId: z.string().min(1),
      stars: z.number().int(),
      note: z.string().nullable(),
      hiddenAt: z.string().nullable(),
    })
    .nullable(),
  /** Every report on the same target, this one included, whatever its status. */
  reportsOnTarget: z.number().int().positive(),
});
export type AdminReportQueueItem = z.infer<typeof AdminReportQueueItem>;

export const AdminReportsResponse = z.object({ reports: z.array(AdminReportQueueItem) });
export type AdminReportsResponse = z.infer<typeof AdminReportsResponse>;

export const AdminReportActionResponse = z.object({ report: ContentReport });
export type AdminReportActionResponse = z.infer<typeof AdminReportActionResponse>;
