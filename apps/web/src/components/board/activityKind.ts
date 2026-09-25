import type { ActivityKind } from "@tc/contracts";
import { KIND_LABEL } from "@tc/pages";

// The variants the kind badges use — `Badge` carries every one of them
// (components/ui/badge.tsx).
type KindBadgeVariant = "warning" | "info";

// Copy for a kind, shared by the card's badge and the editor's picker. It lives
// in `@tc/pages` because the notebook prints the same words.
export { KIND_LABEL };

// The handoff's own map (`Trip Planner Redesign.dc.html:3740`):
//   { booked: ['Booked','success'], hold: ['Holding','warning'],
//     idea: ['Idea','neutral'], transit: ['Travel','info'] }[kind] || ['','neutral']
//
// M28 (ADR-054) cut it to three kinds. `pending` takes `hold`'s amber, since
// it absorbed both `hold` and `idea` and means the same thing hold did: not
// settled yet. `booked`'s green went with it: `booked` folded into `planned`.
//
// `planned` falls through to that empty string, and the null here is that
// fall-through made explicit rather than a gap. It is the contract's zero
// value (packages/contracts/src/activity.ts), so a "Planned" badge would sit
// on most stops and separate nothing from anything.
const KIND_BADGE_VARIANT: Record<ActivityKind, KindBadgeVariant | null> = {
  planned: null,
  pending: "warning",
  transit: "info",
};

/** The badge a kind earns, or null when it earns none. */
export function kindBadge(kind: ActivityKind): { label: string; variant: KindBadgeVariant } | null {
  const variant = KIND_BADGE_VARIANT[kind];
  return variant === null ? null : { label: KIND_LABEL[kind], variant };
}

// Picker order: `planned` first because it is the default a stop starts on,
// then `pending`, and `transit` last because it says what a stop IS rather
// than how settled it is.
export const KIND_OPTIONS: readonly ActivityKind[] = ["planned", "pending", "transit"];
