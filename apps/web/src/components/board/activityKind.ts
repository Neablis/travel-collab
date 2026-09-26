import type { ActivityKind, ActivityView, PendingReason } from "@tc/contracts";
import { KIND_LABEL } from "@tc/pages";
import { PENDING_REASON_DISPLAY } from "./PendingReasonPicker";
import { MODE_DISPLAY } from "./TravelModePicker";

// The variants the kind badges use — `Badge` carries every one of them
// (components/ui/badge.tsx).
type KindBadgeVariant = "warning" | "info" | "neutral";

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

// ADR-055. Exhaustive, so a new reason cannot ship without deciding its colour.
// `maybe` is neutral: a maybe is not a to-do, so it does not borrow the
// warning's urgency (the handoff's own map, `…Redesign.dc.html:9468`).
const PENDING_REASON_BADGE_VARIANT: Record<PendingReason, KindBadgeVariant> = {
  book: "warning",
  maybe: "neutral",
};

/**
 * The badge a stop earns, or null when it earns none.
 *
 * A kind's detail, when the stop has one, IS the badge (SPEC §36.9, ADR-055):
 * a pending stop reads **To book** or **Maybe**, and a transit stop reads its
 * mode (*Train*). Without one it falls back to the kind's own word,
 * which is what every stop written before the detail existed shows.
 */
export function kindBadge(
  stop: Pick<ActivityView, "kind" | "mode" | "pendingReason">,
): { label: string; variant: KindBadgeVariant } | null {
  const variant = KIND_BADGE_VARIANT[stop.kind];
  if (variant === null) return null;
  if (stop.kind === "pending" && stop.pendingReason !== null) {
    return { label: PENDING_REASON_DISPLAY[stop.pendingReason].label, variant: PENDING_REASON_BADGE_VARIANT[stop.pendingReason] };
  }
  if (stop.kind === "transit" && stop.mode !== null) return { label: MODE_DISPLAY[stop.mode].label, variant };
  return { label: KIND_LABEL[stop.kind], variant };
}

// Picker order: `planned` first because it is the default a stop starts on,
// then `pending`, and `transit` last because it says what a stop IS rather
// than how settled it is.
export const KIND_OPTIONS: readonly ActivityKind[] = ["planned", "pending", "transit"];
