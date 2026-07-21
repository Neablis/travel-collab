import { Sheet } from "web";

export function Default() {
  return (
    <Sheet open onOpenChange={() => {}} title="Trip settings">
      <div style={{ fontSize: 14, color: "#151d2e" }}>Currency, budget, and collaborators.</div>
    </Sheet>
  );
}
