import Link from "next/link";
import type { ReportStatus } from "@tc/contracts";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import type { AdminNotebooksReport } from "@/lib/adminNotebooks";
import { displayNameFor } from "@/lib/displayName";
import type { AdminReportQueueItem } from "@/lib/reports";
import { count, shortDay } from "./aiFormat";
import { ReportsPanel } from "./ReportsPanel";

// **The Library tab's notebooks, the half with a source** (M36 link 5, D5).
//
// The design draws four tiles, three weekly charts and a table ranked by trips
// started. Only *Saved to a library* and the table's Notebook, By and Saved
// columns have anything to read: there is no share link and no record of a
// trip seeded from a saved notebook (DRIFT D21), and a saved notebook is one
// page, so a Pages column would be a constant. The rest is not drawn at all —
// not as zeros, which would read as "nobody shares", and not as a Preview. The
// footer says so in one line, which is the only place those words appear.
//
// With nothing to rank by, the table is the newest saves and is titled as
// such; *start the most trips* would be a claim about an ordering it cannot make.

const HEAD = "whitespace-nowrap border-b border-border-strong bg-moss font-mono";

/** Where a notebook's owner opens in the console — the Users tab's account page. */
export function accountHref(ownerId: string): string {
  return `/admin?tab=users&account=${encodeURIComponent(ownerId)}`;
}

/**
 * The Library tab's body: **Reports first** — the only part of the tab that
 * needs action (spec § Library) — then notebooks. Hiding a day takes it off
 * Discover, the board and profiles; the author keeps their copy. First paint
 * from the server, actions from the browser against the gated endpoints:
 * `ReportsPanel` says why.
 */
export function LibraryTab({
  reports,
  notebooks,
}: {
  reports: Record<ReportStatus, AdminReportQueueItem[]>;
  notebooks: AdminNotebooksReport;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Reports">
        <ReportsPanel initial={reports} />
      </Panel>
      <LibraryNotebooks report={notebooks} />
    </div>
  );
}

/**
 * The notebooks section under Reports: the one tile and the latest saves, or
 * the `no-notebooks` empty box in their place. Reports is drawn by the page and
 * stays either way.
 */
export function LibraryNotebooks({ report }: { report: AdminNotebooksReport }) {
  if (report.saved === 0) {
    return (
      <EmptyState
        title="No notebooks saved yet"
        body="Every trip has notebook pages, but nobody has saved one to their library."
      />
    );
  }
  return (
    <section aria-label="Notebooks" className="flex flex-col gap-3">
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-hairline bg-surface sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2 px-5 py-4" data-testid="notebooks-saved">
          <Text as="span" className="text-sm font-semibold">
            Saved to a library
          </Text>
          <span className="flex items-baseline gap-2">
            <DataText className="text-2xl font-semibold leading-none text-ink">{count(report.saved)}</DataText>
            <DataText size="xs" className={report.savedInWindow > 0 ? "text-success-ink" : "text-slate"}>
              +{count(report.savedInWindow)}
            </DataText>
          </span>
          <Text variant="secondary">
            Notebooks saved from a trip, all time. {count(report.savedInWindow)} in the last {report.windowDays} days.
          </Text>
        </div>
      </div>

      <Panel title="Saved most recently">
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH className={HEAD}>Notebook</TH>
                  <TH className={HEAD}>By</TH>
                  <TH className={HEAD}>Saved</TH>
                </TR>
              </THead>
              <TBody>
                {report.recent.map((row) => (
                  <TR key={row.savedNotebookId}>
                    <TD className="font-semibold text-ink">{row.title}</TD>
                    <TD>
                      <Link href={accountHref(row.ownerId)} className="text-ink underline">
                        {displayNameFor({ userId: row.ownerId, email: row.ownerEmail })}
                      </Link>
                    </TD>
                    <TD>
                      <DataText as="time" dateTime={row.savedAt}>
                        {shortDay(row.savedAt)}
                      </DataText>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <Text variant="secondary" className="text-sm" data-testid="notebooks-footer">
            The {report.recent.length} saved most recently. Shares of a notebook and trips started from one are not
            recorded yet, so neither is counted here.
          </Text>
        </div>
      </Panel>
    </section>
  );
}
