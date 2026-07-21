import type { CostsTablePayload } from "@tc/pages";
import { Table, THead, TBody, TFoot, TR, TH, TD } from "../../ui/table";

// Read-only block: renders the cost breakdown table from the resolver payload only.
export function CostsTableBlock({ payload }: { payload: CostsTablePayload }) {
  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <Table>
        <THead>
          <TR>
            <TH>Item</TH>
            <TH className="text-right">Amount</TH>
          </TR>
        </THead>
        <TBody>
          {payload.rows.map((row, i) => (
            <TR key={i}>
              <TD>{row.label}</TD>
              <TD className="text-right">{row.amount}</TD>
            </TR>
          ))}
        </TBody>
        <TFoot>
          <TR>
            <TH>Total</TH>
            <TH className="text-right">{payload.total}</TH>
          </TR>
        </TFoot>
      </Table>
    </div>
  );
}
