import type { SuggestionChange } from "@tc/contracts";

/**
 * The changes "Accept all" accepts, in the order it accepts them (W77): every
 * pending change but the ones that no longer apply (`stale`) and every change
 * built on one of those, with each parent before the changes that depend on it.
 *
 * A change built on a stale one could never be accepted — the server refuses
 * it while its parent is pending (§2.7) — so it is left for the reviewer
 * rather than tried and refused. A parent that is not in `pending` has already
 * been decided, and does not hold its dependents back.
 */
export function acceptAllOrder(pending: readonly SuggestionChange[], stale: ReadonlySet<string>): SuggestionChange[] {
  const byId = new Map(pending.map((c) => [c.id, c]));
  const skipped = new Set<string>();
  const isSkipped = (c: SuggestionChange): boolean => {
    if (skipped.has(c.id)) return true;
    const skip = stale.has(c.id) || c.dependsOn.some((p) => byId.has(p) && isSkipped(byId.get(p)!));
    if (skip) skipped.add(c.id);
    return skip;
  };
  const order: SuggestionChange[] = [];
  const placed = new Set<string>();
  // Dependencies only point at earlier changes (server/suggestions/dependencies.ts),
  // so this walk cannot cycle.
  const place = (c: SuggestionChange) => {
    if (placed.has(c.id) || isSkipped(c)) return;
    for (const p of c.dependsOn) {
      const parent = byId.get(p);
      if (parent) place(parent);
    }
    placed.add(c.id);
    order.push(c);
  };
  pending.forEach(place);
  return order;
}
