import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import type { AdminSignupsByRefRow } from "@/lib/adminOverview";

// **Signups per channel** (M50 decision 14, ADR-079): each launch link's
// `?ref=`, counted where it ends, at signup. A null ref is a signup that
// brought no channel, or came more than 30 days after it, and reads *direct*.

/** One row per channel, most signups first, with its last 7 days, last 30 days and all time. */
export function SignupsByRefTable({ rows }: { rows: AdminSignupsByRefRow[] }) {
  if (rows.length === 0) return <EmptyState title="No signups yet." />;
  return (
    <div className="overflow-x-auto">
      <Table className="text-xs" aria-label="Signups by channel">
        <THead>
          <TR>
            <TH>Channel</TH>
            <TH className="text-right">Last 7 days</TH>
            <TH className="text-right">Last 30 days</TH>
            <TH className="text-right">All time</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.ref ?? ""}>
              <TD className={row.ref === null ? "text-slate" : "font-mono text-ink"}>{row.ref ?? "direct"}</TD>
              <TD className="text-right font-mono text-ink">{row.last7Days}</TD>
              <TD className="text-right font-mono text-ink">{row.last30Days}</TD>
              <TD className="text-right font-mono text-ink">{row.allTime}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
