import { Card } from "web";

export function Default() {
  return (
    <Card style={{ width: 280 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#151d2e" }}>Amalfi Coast Drive</div>
      <div style={{ fontSize: 13, color: "#5a6472", marginTop: 4 }}>Day 3 · 3 stops · 2h 40m</div>
    </Card>
  );
}

export function Raised() {
  return (
    <Card raised style={{ width: 280 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#151d2e" }}>Villa San Michele</div>
      <div style={{ fontSize: 13, color: "#5a6472", marginTop: 4 }}>10:00 AM · 18.00 EUR</div>
    </Card>
  );
}
