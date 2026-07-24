import { Popover, Button } from "web";

export function Default() {
  return (
    <div style={{ padding: 40 }}>
      <Popover open onOpenChange={() => {}} trigger={<Button variant="secondary" size="sm">Filters</Button>}>
        <div style={{ fontSize: 14, color: "#151d2e" }}>Show only confirmed activities.</div>
      </Popover>
    </div>
  );
}
