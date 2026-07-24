import { TabStrip } from "web";

export function Default() {
  return (
    <TabStrip
      aria-label="Trip view"
      value="itinerary"
      onValueChange={() => {}}
      options={[
        { value: "itinerary", label: "Itinerary" },
        { value: "map", label: "Map" },
        { value: "budget", label: "Budget" },
      ]}
    />
  );
}
