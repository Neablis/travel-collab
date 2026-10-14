import type { ActivityKind, ActivityTag } from "@tc/contracts";

// The words a person reads for a closed vocabulary — ONE source, for the board
// (a stop card's badge and tag chips, the stop editor's pickers) and for the
// notebook (a `field` widget printing `stop.kind`, the widget filter selects,
// the spend chart's stacks). They lived in `apps/web` until the notebook needed
// them too; a second copy is how "Travel" on the card becomes "transit" on the page.
//
// Keyed by the contract enums, so a value added there fails to compile here
// until it has a label.

/** Copy for a kind. `transit` is not its own word ("Travel"). */
export const KIND_LABEL: Record<ActivityKind, string> = {
  planned: "Planned",
  pending: "Pending",
  transit: "Travel",
};

/** Copy for a tag (ADR-070). The key `meal` stays; only its word became "Food". */
export const TAG_LABEL: Record<ActivityTag, string> = {
  meal: "Food",
  lodging: "Lodging",
  ticketed: "Ticketed",
  outdoors: "Outdoors",
  drinks: "Drinks",
  nightlife: "Nightlife",
  museum: "Museum",
  sight: "Sight",
  beach: "Beach",
  shopping: "Shopping",
  show: "Show",
  tour: "Tour",
  wellness: "Wellness",
  sports: "Sports",
};

// One lookup by value, because a manifest `enum` value reaches `kinds.ts`
// without the field it came from. That is sound only while no value is in two
// vocabularies; `enumLabels.test.ts` asserts they are disjoint, and that every
// enum the manifest publishes is covered.
const ENUM_LABEL: Readonly<Record<string, string>> = { ...KIND_LABEL, ...TAG_LABEL };

/**
 * A manifest enum value as a person reads it. A value with no label — a stored
 * value this build no longer declares — prints as itself rather than as nothing.
 */
export function enumLabel(value: string): string {
  return Object.hasOwn(ENUM_LABEL, value) ? ENUM_LABEL[value]! : value;
}
