"use client";

import type { TripDetail } from "@tc/contracts";
import { DataText } from "../ui/data-text";
import { Table, THead, TBody, TR, TH, TD } from "../ui/table";
import { Badge } from "../ui/badge";
import { EmptyState } from "../ui/empty-state";
import { dailyRows } from "./dailyOverviewData";
import { formatMoney } from "./formatMoney";

export function DailyOverviewLens({ detail }: { detail: TripDetail }) {
  const rows = dailyRows(detail);

  if (rows.length === 0) {
    return <EmptyState title="No days yet." />;
  }

  return (
    <div data-testid="daily-overview-lens" className="flex flex-col gap-2">
      <Table>
        <THead>
          <TR>
            <TH>Day</TH>
            <TH>Date</TH>
            <TH className="text-right">Activities</TH>
            <TH className="text-right">Subtotal</TH>
            <TH></TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.dayId} data-testid={`daily-overview-row-${row.dayId}`}>
              <TD>Day {row.ordinal}</TD>
              <TD>{row.date ? <DataText>{row.date}</DataText> : "—"}</TD>
              <TD className="text-right">{row.activityCount}</TD>
              <TD className="text-right">
                <DataText>{formatMoney(row.costSubtotal, detail.currency)}</DataText>
              </TD>
              <TD>
                {row.conflictCount > 0 && (
                  <Badge variant="warning" data-testid={`daily-overview-conflict-badge-${row.dayId}`}>
                    {row.conflictCount} conflict{row.conflictCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
        <tfoot>
          <TR data-testid="daily-overview-footer" className="border-t border-border-strong font-semibold">
            <TD colSpan={3}>Trip total</TD>
            <TD className="text-right">
              <DataText>{formatMoney(detail.tripCostTotal, detail.currency)}</DataText>
            </TD>
            <TD></TD>
          </TR>
        </tfoot>
      </Table>
    </div>
  );
}
