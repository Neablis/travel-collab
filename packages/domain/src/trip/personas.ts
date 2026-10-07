import { PersonColor } from "@tc/contracts";

const PALETTE = PersonColor.options;

// Palette order, wrapping: a shift past the last colour lands on the first.
const colorAt = (i: number): PersonColor => PALETTE[i % PALETTE.length]!;

/**
 * The colour a person who never chose one starts from. FNV-1a over the
 * userId's UTF-16 code units: stable across calls, processes and releases, so
 * their chip does not change colour between page loads — and it must stay
 * stable, because changing this function recolours every such person at once.
 */
export function defaultPersonColor(userId: string): PersonColor {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return colorAt(hash >>> 0);
}

/**
 * Each member's colour on one trip (M38 D3). Colour is personal, and a trip
 * resolves clashes at render time rather than refusing a join: requiring a
 * unique colour would make joining fail for a reason the joiner cannot see.
 *
 * `members` must be in join order, owner first (as `TripAccess.members` is).
 *
 * 1. In join order, the first member to have stored a colour keeps it.
 * 2. Everyone else — a later clasher, or a member who stored nothing and
 *    starts from `defaultPersonColor` — then takes, in join order, the first
 *    colour from their starting point onward (palette order, wrapping) that no
 *    one has stored or been given. An explicit choice outranks a derived one,
 *    even a later joiner's, so a member who chose a colour no one else chose
 *    always sees it.
 * 3. With more members than colours, a member with nowhere free keeps their
 *    starting colour. A clash is better than a throw, and it is still the same
 *    answer every time.
 *
 * Stored choices are read, never changed.
 */
export function resolveTripColors(
  members: readonly { userId: string; color: PersonColor | null }[],
): Map<string, PersonColor> {
  const kept = new Map<string, PersonColor>();
  const taken = new Set<PersonColor>();
  for (const { userId, color } of members) {
    if (color !== null && !taken.has(color)) {
      kept.set(userId, color);
      taken.add(color);
    }
  }

  const out = new Map<string, PersonColor>();
  for (const { userId, color } of members) {
    const mine = kept.get(userId);
    if (mine !== undefined) {
      out.set(userId, mine);
      continue;
    }
    const start = PALETTE.indexOf(color ?? defaultPersonColor(userId));
    let given = colorAt(start);
    for (let step = 0; step < PALETTE.length; step++) {
      const candidate = colorAt(start + step);
      if (!taken.has(candidate)) {
        given = candidate;
        break;
      }
    }
    out.set(userId, given);
    taken.add(given);
  }
  return out;
}
