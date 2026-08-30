// The one place the domain's city rule crosses into `apps/web`'s persistence
// layer, and the only module a maintenance script may import to get it.
//
// AGENTS.md's architecture map is explicit: `src/server/**` is the ONLY code
// that may import `packages/domain`. `apps/web/scripts/**` is outside the
// CI-enforced lint wall (`eslint.config.mjs` scopes it to `src/**`), so a
// script importing the domain directly passes lint while still breaking the
// rule the wall exists to hold — which is how ADR-002's extraction property
// erodes: not by a violation the wall catches, but by one it never sees.
//
// It is also not indirection for its own sake. Two callers need exactly this
// bridge — the `0012` cities backfill and the demo seed — and neither may
// reach `packages/domain` itself.
//
// Deliberately written with EXPLICIT file extensions and no `@/` alias: a
// plain Node script (`node --experimental-strip-types`) resolves this module
// by path, and Node's ESM resolver handles neither extensionless relative
// imports nor the alias. Keep it that way, or the scripts stop running for a
// reason that reads like a code fault.
import { citiesOfStops } from "../../../../packages/domain/src/trip/cities.ts";
import type { SavedStop } from "@tc/contracts";

/**
 * The cities a saved day covers, derived from its stops.
 *
 * A thin re-export on purpose: the rule itself is the domain's, shared with
 * `citiesOfDay` so a saved day and a trip day can never disagree about what
 * cities they contain. A second implementation here would be free to drift,
 * and a public profile whose cities disagree with Discover's is an exit-gate
 * box, not a rounding error.
 */
export function savedDayCities(stops: readonly SavedStop[]): string[] {
  return citiesOfStops(stops);
}
