import type { ActivityMode } from "@tc/contracts";

// Here rather than beside the picker's icons (`board/TravelModePicker.tsx`,
// which spreads these into `MODE_DISPLAY`) so the map can name a leg's mode
// without `components/lenses` importing `components/board`: that edge would
// close one more folder cycle in the cluster KI-2026-09-23-c is untangling.
// Exhaustive, so an eighth mode in the contract fails to compile here.
/** The word for each travel mode, as the transit badge, the river block and the map's leg list print it. */
export const MODE_LABEL: Record<ActivityMode, string> = {
  walk: "On foot",
  bus: "Bus",
  train: "Train",
  flight: "Flight",
  ferry: "Ferry",
  car: "Car",
  bike: "Bike",
};
