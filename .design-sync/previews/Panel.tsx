import { Panel, Button } from "web";

export function Default() {
  return (
    <Panel title="Trip settings" style={{ width: 320 }}>
      <div style={{ fontSize: 14, color: "#151d2e" }}>Currency, budget, and collaborators.</div>
    </Panel>
  );
}

export function WithActions() {
  return (
    <Panel title="History" actions={<Button size="sm" variant="ghost">Clear</Button>} style={{ width: 320 }}>
      <div style={{ fontSize: 14, color: "#151d2e" }}>12 changes today.</div>
    </Panel>
  );
}
