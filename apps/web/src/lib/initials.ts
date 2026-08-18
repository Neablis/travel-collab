// Two initials from a member's userId, e.g. "dev-alice" -> "DA". TripMember
// (packages/contracts/src/trip.ts) only carries a userId, no display name —
// this is a cosmetic stand-in for a real avatar/initial, not sourced from any
// name field that doesn't exist on the DTO.
//
// Shared by NextTripHero (hero avatar stack) and TripCard (grid-card footer
// avatar stack) so both render the same initials for the same member.
export function initialsFor(userId: string): string {
  const parts = userId.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const chars = parts.length >= 2 ? [parts[0]![0], parts[1]![0]] : [...userId.replace(/[^a-zA-Z0-9]/g, "")].slice(0, 2);
  return chars.join("").toUpperCase() || "?";
}
