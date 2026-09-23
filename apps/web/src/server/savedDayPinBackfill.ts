import { after } from "next/server";
import type { SavedDay } from "@tc/contracts";
import type { GeocodeCharge } from "@/server/ai/geocodeEnrichment";
import { serverConfig } from "@/server/config";
import { getGeocoder, type Geocoder } from "@/server/geocoding";
import { consumeQuota, geocodeQuota } from "@/server/quota";
import { backfillSavedDayStops } from "@/server/savedDays";
import { hasUnpinnedStops, pinStops } from "@/server/savedDayPins";

// The I/O half of putting a Playbook's stops on its map (M27 link 10): read the
// row, spend the reader's quota, write the coordinates back, and do it after
// the response. What gets looked up and what is accepted is `savedDayPins.ts`,
// and so is the reasoning for doing any of this on a read.

/**
 * Days with a backfill running in this instance. A reader's client re-reads
 * while the answer is `pinning`, and without this each re-read would start a
 * second pass over the same stops. Per instance only: two instances can still
 * overlap, which costs duplicate lookups and nothing else, since
 * `backfillSavedDayStops` writes only over the exact stops it read.
 */
const inFlight = new Set<string>();

/**
 * Days whose last pass placed nothing, and until when to leave them alone. A
 * city the vendor cannot find would otherwise be looked up again on every
 * re-read of every page view. Per instance, like `inFlight`.
 */
const stalled = new Map<string, number>();
const STALLED_MS = 10 * 60_000;

export type BackfillDeps = {
  configured?: boolean;
  geocoder?: () => Geocoder;
  charge?: (readerId: string) => GeocodeCharge;
  sleep?: (ms: number) => Promise<void>;
  cap?: number;
  now?: () => number;
};

/** The reader pays: one unit of their own geocode quota per lookup (KI-93). */
const readerCharge = (readerId: string): GeocodeCharge => async () =>
  (await consumeQuota(geocodeQuota(), readerId)).allowed;

/**
 * One backfill pass over one day, persisted.
 *
 * `"unconfigured"` without a LocationIQ key — local and e2e runs — and no
 * geocoder is ever built, because `getGeocoder()` throws without one.
 */
export async function backfillSavedDayPins(
  savedDayId: string,
  readerId: string,
  deps: BackfillDeps = {},
): Promise<"unconfigured" | "nothing-to-do" | "written" | "unchanged" | "gone" | "raced"> {
  if (!(deps.configured ?? serverConfig.locationIqApiKey !== "")) return "unconfigured";
  const charge = (deps.charge ?? readerCharge)(readerId);
  const now = deps.now ?? Date.now;
  inFlight.add(savedDayId);
  try {
    const outcome = await backfillSavedDayStops(savedDayId, async (stops) => {
      if (!hasUnpinnedStops(stops)) return null;
      const { stops: pinned } = await pinStops(stops, {
        geocoder: (deps.geocoder ?? getGeocoder)(),
        charge,
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
        ...(deps.cap !== undefined ? { cap: deps.cap } : {}),
      });
      return pinned;
    });
    if (outcome === "unchanged") stalled.set(savedDayId, now() + STALLED_MS);
    else stalled.delete(savedDayId);
    return outcome;
  } finally {
    inFlight.delete(savedDayId);
  }
}

/**
 * Called by the shared-day read: start a pass after the response is sent, and
 * say whether one is under way so the client knows to read again.
 *
 * **After the response, not inside it.** The vendor allows two requests a
 * second, so even a small Playbook is seconds of lookups, and the page must not
 * wait on them. The map's frame holds its full height from the first paint —
 * in its loading state while this runs — so the map arriving later moves
 * nothing on the page.
 *
 * `after` throws outside a request scope (a route handler called directly, as
 * the integration tests do); that is treated as "not scheduled", so a test
 * environment that happens to hold a key never reaches the vendor from a read.
 */
export function schedulePinBackfill(day: SavedDay, readerId: string, deps: BackfillDeps = {}): boolean {
  if (!(deps.configured ?? serverConfig.locationIqApiKey !== "")) return false;
  if (!hasUnpinnedStops(day.stops)) return false;
  if (inFlight.has(day.savedDayId)) return true;
  const until = stalled.get(day.savedDayId);
  if (until !== undefined && until > (deps.now ?? Date.now)()) return false;
  // Marked now rather than when the pass starts: a re-read landing between the
  // response and the start of `after` would otherwise schedule a second pass.
  inFlight.add(day.savedDayId);
  try {
    after(() => backfillSavedDayPins(day.savedDayId, readerId, deps).then(() => undefined, () => undefined));
  } catch {
    inFlight.delete(day.savedDayId);
    return false;
  }
  return true;
}
