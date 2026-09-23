import { AdminReportAction } from "@tc/contracts";
import { AdminReportActionResponse } from "@/lib/reports";
import { requireAdminApi } from "@/server/entitlements/requireAdmin";
import { actOnReport } from "@/server/reports";

// An operator acts on one report (M12 link 6): hide or restore what it names,
// or dismiss it. One decision settles every open report on the same target —
// `actOnReport` says which.
//
//   * 400 `invalid-action` — not an `AdminReportAction`;
//     400 `action-mismatch` — a review action on a day report.
//   * 404 — not an operator (`requireAdminApi`), no such report, or what it
//     names no longer exists.
/** Applies an operator's `AdminReportAction` to one report and returns the settled report. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const body = AdminReportAction.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid-action", issues: body.error.issues }, { status: 400 });
  }
  const { reportId } = await params;
  const result = await actOnReport(reportId, body.data, guard.userId);
  if (!result.ok) {
    return result.error.code === "action-mismatch"
      ? Response.json({ error: "action-mismatch", message: result.error.message }, { status: 400 })
      : Response.json({ error: "not-found" }, { status: 404 });
  }
  return Response.json(AdminReportActionResponse.parse({ report: result.value }));
}
