import type { DiscoverDay } from "@/lib/playbooks";
import sea from "./landingSea.generated.json";

// The front door's sea of notebooks (M51): every public day in the library as
// the Discover card it is, written by `scripts/landing-demo.ts` and held to
// the generator by `pnpm landing:verify`, as the demo snapshots are. The
// landing may not fetch (SPEC §14), so this is the whole library it shows.

/** A cell's footprint on the sea's grid, columns by rows. */
export type SeaCellSize = "1x1" | "2x1" | "1x2" | "2x2" | "3x1" | "1x3";

/**
 * A card with no calendar date: a day's `createdAt` and `publishedAt` are its
 * import's `keptOn`, a date the front door would freeze, and its source trip's
 * name is often a month ("Paris in May"). `DiscoverCard` draws none of them.
 */
export type SeaDay = Omit<DiscoverDay, "createdAt" | "publishedAt" | "sourceTripName">;

export type SeaCell = {
  day: SeaDay;
  size: SeaCellSize;
  /** The bundle the day came from (`greek-islands`), which is how a moment finds its own cluster. */
  group: string;
};

export type LandingSea = {
  /** Every public library day, in a fixed shuffled order, each linked to its canonical day page. */
  cells: (SeaCell & { href: string })[];
  /**
   * The demo seed's public Japan days, for the cluster around the notebook.
   * Unlinked: production's library holds no such day, so a link would 404.
   */
  japan: (SeaCell & { href: null })[];
};

// Through `unknown` for the reason `landingDemo.ts` gives: JSON infers
// `string` where the type names a union. The generator's return type is
// checked by tsc and the verify step holds this file to it.
export const LANDING_SEA = sea as unknown as LandingSea;
