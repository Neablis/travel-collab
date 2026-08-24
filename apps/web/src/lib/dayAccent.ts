export const ACCENT_FAMILIES = ["brand", "info", "success", "warning", "danger"] as const;
export type AccentFamily = (typeof ACCENT_FAMILIES)[number] | "neutral";
export type DayAccent = { tint: AccentFamily; ink: AccentFamily; solid: AccentFamily };

// Stable string hash (djb2) → family index. Same city always maps to the same
// home bucket; collisions are resolved by dayAccents' two-pass probe below.
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

// Resolves a whole trip's cities at once, so collisions between cities in the
// SAME trip can be probed and avoided — resolving one city at a time (the old
// dayAccentFor) can't do this, because each call is blind to every other
// day's assignment. Independent per-city hashing let two different cities in
// one trip land on the same family (e.g. Kyoto and Osaka both on "danger"),
// which is indistinguishable on-screen since both render as the same accent.
//
// Two-pass hash + linear-probe over the 5 semantic families:
//   1. Distinct non-null cities, sorted, so the assignment is independent of
//      the order cities/days appear in the input.
//   2. Pass 1: each city claims its raw hash bucket if free.
//   3. Pass 2: any city whose home bucket was already taken probes forward
//      (wrapping) for the next free bucket. With more than 5 distinct cities
//      every bucket eventually fills; once that happens the probe can't find
//      a free slot and falls back to the raw (colliding) hash bucket rather
//      than throwing — collisions become unavoidable with only 5 families,
//      and this degrades ungracefully-but-safely instead of crashing.
// `null` cities map to "neutral" without ever consuming a bucket.
export function dayAccents(cities: (string | null)[]): DayAccent[] {
  const distinct = Array.from(new Set(cities.filter((c): c is string => c !== null))).sort();

  const bucketOf = new Map<string, number>();
  const taken = new Array<boolean>(ACCENT_FAMILIES.length).fill(false);

  // Pass 1: claim home buckets.
  const collided: string[] = [];
  for (const city of distinct) {
    const home = hash(city) % ACCENT_FAMILIES.length;
    if (!taken[home]) {
      taken[home] = true;
      bucketOf.set(city, home);
    } else {
      collided.push(city);
    }
  }

  // Pass 2: linear-probe forward from the hash for anything that collided.
  for (const city of collided) {
    const home = hash(city) % ACCENT_FAMILIES.length;
    let bucket = home;
    let found = -1;
    for (let i = 0; i < ACCENT_FAMILIES.length; i++) {
      const candidate = (home + i) % ACCENT_FAMILIES.length;
      if (!taken[candidate]) {
        found = candidate;
        break;
      }
    }
    bucket = found === -1 ? home : found;
    if (found !== -1) taken[found] = true;
    bucketOf.set(city, bucket);
  }

  return cities.map((city) => {
    if (city === null) {
      return { tint: "neutral", ink: "neutral", solid: "neutral" };
    }
    const family = ACCENT_FAMILIES[bucketOf.get(city)!]!;
    return { tint: family, ink: family, solid: family };
  });
}
