import { addDaysIso } from "@/lib/dates";
import { formatTripDateWithYear } from "@/lib/formatDate";
import type { InviteCard } from "./invite";

// The words on a preview card and in its og:title / og:description, written
// once. The image route and the `meta` route both read these, so the picture a
// chat app draws and the text it prints beside it cannot disagree.

/** The product line the referral card closes on. */
export const PRODUCT_LINE = "Trips, planned together";

/** What one card says: the small label, the headline, and the line under it. */
export type CardCopy = { label: string; title: string; description: string };

/** The invite card's words, personal or generic. Pure. */
export function inviteCopy(card: InviteCard): CardCopy {
  const label = "Caesura · trip invite";
  if (card.kind === "generic") {
    return {
      label,
      title: "You're invited to a trip on Caesura",
      description: "Open the invite to see the trip and join the plan.",
    };
  }
  return {
    label,
    title: `${card.inviterFirstName} invited you to plan ${card.tripName}`,
    description: factsLine(card),
  };
}

/**
 * The referral card's words. `null` is a code that names nobody, which gets a
 * nameless invitation rather than a guess. Pure.
 */
export function referralCopy(referrerFirstName: string | null): CardCopy {
  return {
    label: "Caesura",
    title: referrerFirstName === null ? "You're invited to Caesura" : `${referrerFirstName} invited you to Caesura`,
    description: PRODUCT_LINE,
  };
}

// "Jun 1, 2027 – Jun 3, 2027 · 3 days · 2 cities · with Dana, Mei, Priya +1".
// The date range is the invite landing's own (`InviteLandingScreen` metaLine).
function factsLine(card: Extract<InviteCard, { kind: "personal" }>): string {
  const parts: string[] = [];
  if (card.startDate !== null) {
    const end = card.dayCount > 1 ? addDaysIso(card.startDate, card.dayCount - 1) : card.startDate;
    parts.push(
      end === card.startDate
        ? formatTripDateWithYear(card.startDate)
        : `${formatTripDateWithYear(card.startDate)} – ${formatTripDateWithYear(end)}`,
    );
  }
  parts.push(card.dayCount === 1 ? "1 day" : `${card.dayCount} days`);
  parts.push(card.cityCount === 1 ? "1 city" : `${card.cityCount} cities`);
  if (card.crew.length > 0) {
    parts.push(`with ${card.crew.join(", ")}${card.crewOverflow > 0 ? ` +${card.crewOverflow}` : ""}`);
  }
  return parts.join(" · ");
}
