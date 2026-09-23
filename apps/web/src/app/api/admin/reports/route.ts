import { ReportStatus } from "@tc/contracts";
import { AdminReportsResponse } from "@/lib/reports";
import { requireAdminApi } from "@/server/entitlements/requireAdmin";
import { listReports } from "@/server/reports";

// The operator's report queue (M12 link 6). `?status=` defaults to `open`; a
// non-admin gets `requireAdminApi`'s 404, the route-not-merely-hidden rule M20
// set for the whole admin surface.
export async function GET(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const status = ReportStatus.safeParse(new URL(request.url).searchParams.get("status") ?? "open");
  if (!status.success) {
    return Response.json({ error: "invalid-status", issues: status.error.issues }, { status: 400 });
  }
  return Response.json(AdminReportsResponse.parse({ reports: await listReports({ status: status.data }) }));
}
