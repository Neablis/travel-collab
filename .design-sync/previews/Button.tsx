import { Button } from "web";

export function Variants() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <Button variant="primary">Save trip</Button>
      <Button variant="secondary">Cancel</Button>
      <Button variant="ghost">Skip</Button>
      <Button variant="destructive">Delete activity</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Button variant="primary" size="sm">Add stop</Button>
      <Button variant="primary" size="md">Add stop</Button>
      <Button variant="primary" size="icon" aria-label="Add stop">+</Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Button variant="primary" disabled>Save trip</Button>
      <Button variant="secondary" disabled>Cancel</Button>
    </div>
  );
}
