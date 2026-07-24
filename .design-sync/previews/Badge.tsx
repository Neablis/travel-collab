import { Badge } from "web";

export function Variants() {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Badge variant="neutral">Draft</Badge>
      <Badge variant="brand">Confirmed</Badge>
      <Badge variant="success">Paid</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="danger">Over budget</Badge>
      <Badge variant="info">Shared</Badge>
    </div>
  );
}
