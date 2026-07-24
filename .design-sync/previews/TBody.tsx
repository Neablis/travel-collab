import { Table, THead, TBody, TFoot } from "web";

const rows = [
  { activity: "Ferry to Capri", day: "Day 3", cost: "48.00 EUR" },
  { activity: "Villa San Michele", day: "Day 3", cost: "18.00 EUR" },
  { activity: "Dinner at Da Paolino", day: "Day 3", cost: "112.00 EUR" },
];

export function Default() {
  return (
    <Table style={{ width: 420 }}>
      <THead>
        <tr style={{ borderBottom: "1px solid #dde2da" }}>
          <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#5a6472", textTransform: "uppercase" }}>Activity</th>
          <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#5a6472", textTransform: "uppercase" }}>Day</th>
          <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#5a6472", textTransform: "uppercase" }}>Cost</th>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <tr key={r.activity} style={{ borderBottom: "1px solid #dde2da" }}>
            <td style={{ padding: "6px 8px", fontSize: 14, color: "#151d2e" }}>{r.activity}</td>
            <td style={{ padding: "6px 8px", fontSize: 14, color: "#151d2e" }}>{r.day}</td>
            <td style={{ padding: "6px 8px", fontSize: 14, fontFamily: "var(--font-next-mono)", color: "#151d2e" }}>{r.cost}</td>
          </tr>
        ))}
      </TBody>
      <TFoot>
        <tr>
          <td style={{ padding: "6px 8px", fontSize: 13, fontWeight: 600, color: "#151d2e" }} colSpan={2}>Total</td>
          <td style={{ padding: "6px 8px", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-next-mono)", color: "#151d2e" }}>178.00 EUR</td>
        </tr>
      </TFoot>
    </Table>
  );
}
