"use client";

import { useState } from "react";
import type { AdminReportAction, ReportStatus } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Text } from "@/components/ui/text";
import { actOnReport, fetchAdminReports, type ApiError } from "@/lib/apiClient";
import type { AdminReportQueueItem } from "@/lib/reports";
import { ReportRow } from "./ReportRow";

// **The one place an operator acts on reports** (M12 link 6). No queue is
// drawn in the design handoff, so this borrows the console's own vocabulary
// rather than inventing one: the accounts table's counted pill filters for the
// three statuses, and a row per report carrying enough to decide without
// opening the day — the same brief `AdminReportQueueItem` was shaped for.
//
// **First paint comes from the server; every write and re-read after it from
// the browser.** The page reads `listReports` directly for the reason its
// header gives for `adminOverview` (2026-09-14): a server component calling a
// server function has no second request and no cookie crossing a network
// boundary. The actions cannot be done that way — they are a click — so they
// go through `actOnReport` and `fetchAdminReports`, the browser's own session
// against endpoints that each run `requireAdminApi`. The gate is therefore
// checked on both paths and inherited by neither: the page's `adminUserId()`
// guards the read, and the endpoint guards every write.
//
// **A write re-reads all three lists rather than moving the row by hand.**
// One decision settles every open report on the target (`actOnReport`), so a
// hide can empty rows this panel never touched; the server knows which, and a
// local splice would have to guess.

const STATUSES: readonly { id: ReportStatus; label: string; empty: string }[] = [
  { id: "open", label: "Open", empty: "Nothing open. Reports people file on shared days and reviews land here." },
  { id: "actioned", label: "Actioned", empty: "Nothing actioned yet." },
  { id: "dismissed", label: "Dismissed", empty: "Nothing dismissed yet." },
];

/** What an operator is told when the server refuses an action. */
function refusalOf(error: ApiError): string {
  if (error.status === 0) return "The action did not reach the server. Nothing changed.";
  if (error.status === 404) return "That report, or what it names, no longer exists.";
  if (error.message === "action-mismatch") return "That action does not fit this report.";
  return `Refused (${error.status}).`;
}

/**
 * The operator's report queue: Open / Actioned / Dismissed, one row per report,
 * and the hide, restore and dismiss actions each row's state allows.
 */
export function ReportsPanel({ initial }: { initial: Record<ReportStatus, AdminReportQueueItem[]> }) {
  const [queues, setQueues] = useState(initial);
  const [status, setStatus] = useState<ReportStatus>("open");
  const [stale, setStale] = useState(false);

  async function reread(): Promise<void> {
    const [open, actioned, dismissed] = await Promise.all([
      fetchAdminReports("open"),
      fetchAdminReports("actioned"),
      fetchAdminReports("dismissed"),
    ]);
    if (open.ok && actioned.ok && dismissed.ok) {
      setQueues({ open: open.value, actioned: actioned.value, dismissed: dismissed.value });
      setStale(false);
    } else {
      // The action landed; only the re-read failed. Saying so beats leaving a
      // row in Open that an operator would reasonably act on a second time.
      setStale(true);
    }
  }

  /** Resolves to a refusal to show on the row, or null once the lists are re-read. */
  async function act(reportId: string, action: AdminReportAction): Promise<string | null> {
    const result = await actOnReport(reportId, action);
    if (!result.ok) return refusalOf(result.error);
    await reread();
    return null;
  }

  const current = STATUSES.find((s) => s.id === status)!;
  const rows = queues[status];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="md"
            className="rounded-full text-sm"
            variant={option.id === status ? "secondary" : "ghost"}
            aria-pressed={option.id === status}
            onClick={() => setStatus(option.id)}
          >
            {option.label}
            <span className="ml-1.5 text-xs text-slate">{queues[option.id].length}</span>
          </Button>
        ))}
      </div>

      {stale && (
        <Text as="span" role="status" className="text-xs text-danger-ink">
          The action was taken, but the lists could not be re-read. Reload the page before acting again.
        </Text>
      )}

      {rows.length === 0 ? (
        <EmptyState title={`No ${current.label.toLowerCase()} reports`} body={current.empty} />
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {rows.map((item) => (
            <ReportRow
              key={item.report.reportId}
              item={item}
              onAct={(action) => act(item.report.reportId, action)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
