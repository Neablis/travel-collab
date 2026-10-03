import { addDaysIso } from "@/lib/dates";
import { formatTripDateWithYear } from "@/lib/formatDate";
import { PLAYBOOKS_BOARD, PLAYBOOKS_GENERIC, dayFactsLine, plural } from "@/lib/playbooksPreview";
import type { InviteCard } from "./invite";
import type { PlaybookCityCard, PlaybookCountryCard, PlaybookDayCard, PlaybookProfileCard } from "./playbooks";

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

export { PLAYBOOKS_BOARD, PLAYBOOKS_GENERIC };

/**
 * A shared day's words: its name over "Kyoto, Osaka · 3 days · 12 stops · by
 * Dana R. · rated 4.6 from 12 reviews", or the generic Playbooks card. Pure.
 *
 * The facts line is `dayFactsLine`, in `lib/` because the day page's meta
 * description is the same line.
 */
export function playbookDayCopy(card: PlaybookDayCard): CardCopy {
  if (card.kind === "generic") return PLAYBOOKS_GENERIC;
  return { label: "Caesura · playbook", title: card.name, description: dayFactsLine(card) };
}

/** A public profile's words: "Dana R.'s playbooks", over its numbers and the cities it knows. Pure. */
export function playbookProfileCopy(card: PlaybookProfileCard): CardCopy {
  if (card.kind === "generic") return PLAYBOOKS_GENERIC;
  const parts = [plural(card.playbooksShared, "playbook")];
  if (card.adds > 0) parts.push(`added to ${plural(card.adds, "trip")}`);
  if (card.cities.length > 0) parts.push(`knows ${card.cities.join(", ")}`);
  return { label: "Caesura · playbooks", title: `${card.author}'s playbooks`, description: parts.join(" · ") };
}

/** Discover for one city: "Kyoto playbooks", and how many days there are. Pure. */
export function playbookCityCopy(card: PlaybookCityCard): CardCopy {
  if (card.kind === "generic") return PLAYBOOKS_GENERIC;
  return {
    label: "Caesura · playbooks",
    title: `${card.city} playbooks`,
    description:
      card.days === 1
        ? `1 day a traveler planned in ${card.city}`
        : `${card.days} days other travelers planned in ${card.city}`,
  };
}

/** A country page's words: "Japan playbooks", and how many days there are. Pure. */
export function playbookCountryCopy(card: PlaybookCountryCard): CardCopy {
  if (card.kind === "generic") return PLAYBOOKS_GENERIC;
  return {
    label: "Caesura · playbooks",
    title: `${card.country} playbooks`,
    description:
      card.days === 1
        ? `1 day a traveler planned in ${card.country}`
        : `${card.days} days other travelers planned in ${card.country}`,
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
