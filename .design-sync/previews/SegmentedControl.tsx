import { SegmentedControl } from "web";

export function Pill() {
  return (
    <SegmentedControl
      aria-label="View"
      value="board"
      onValueChange={() => {}}
      options={[
        { value: "board", label: "Board" },
        { value: "calendar", label: "Calendar" },
        { value: "map", label: "Map" },
      ]}
    />
  );
}

export function Subtle() {
  return (
    <SegmentedControl
      aria-label="Units"
      variant="subtle"
      value="metric"
      onValueChange={() => {}}
      options={[
        { value: "metric", label: "Metric" },
        { value: "imperial", label: "Imperial" },
      ]}
    />
  );
}
