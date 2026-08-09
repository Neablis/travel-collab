export const ACCENT_FAMILIES = ["brand", "info", "success", "warning", "danger"] as const;
export type AccentFamily = (typeof ACCENT_FAMILIES)[number];
export type DayAccent = { tint: AccentFamily; ink: AccentFamily; solid: AccentFamily };

// Stable string hash (djb2) → family index. Same city always maps to the same
// family; empty/nullish city hashes the empty string for a stable fallback.
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function dayAccentFor(city: string | null | undefined): DayAccent {
  const family = ACCENT_FAMILIES[hash(city ?? "") % ACCENT_FAMILIES.length]!;
  return { tint: family, ink: family, solid: family };
}
