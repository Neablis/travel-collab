import type { ActivityKind } from "@tc/contracts";

// The four variants the handoff's badge map names, and no more — `Badge`
// already carries every one of them (components/ui/badge.tsx).
type KindBadgeVariant = "success" | "warning" | "neutral" | "info";

/** Copy for a kind, shared by the card's badge and the editor's picker. */
export const KIND_LABEL: Record<ActivityKind, string> = {
  planned: "Planned",
  idea: "Idea",
  hold: "Holding",
  booked: "Booked",
  transit: "Travel",
};

// The handoff's own map (`Trip Planner Redesign.dc.html:3740`):
//   { booked: ['Booked','success'], hold: ['Holding','warning'],
//     idea: ['Idea','neutral'], transit: ['Travel','info'] }[kind] || ['','neutral']
//
// `planned` falls through to that empty string, and the null here is that
// fall-through made explicit rather than a gap. It is the contract's zero
// value (packages/contracts/src/activity.ts), so a "Planned" badge would sit
// on 68 of 68 seeded stops and separate nothing from anything.
const KIND_BADGE_VARIANT: Record<ActivityKind, KindBadgeVariant | null> = {
  planned: null,
  idea: "neutral",
  hold: "warning",
  booked: "success",
  transit: "info",
};

/** The badge a kind earns, or null when it earns none. */
export function kindBadge(kind: ActivityKind): { label: string; variant: KindBadgeVariant } | null {
  const variant = KIND_BADGE_VARIANT[kind];
  return variant === null ? null : { label: KIND_LABEL[kind], variant };
}

// Picker order: the path a stop actually walks — a thought, then something
// held, then something booked — with `planned` first because it is the
// default a new stop starts on, and `transit` last because it is orthogonal
// to the other four rather than a further step along them.
export const KIND_OPTIONS: readonly ActivityKind[] = ["planned", "idea", "hold", "booked", "transit"];
