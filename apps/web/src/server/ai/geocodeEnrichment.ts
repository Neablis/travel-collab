// AI-planning-specific enrichment step (ADR-007): the model is never trusted
// to supply real lat/lng — it's left to guess (observed live: lat 0, lng 0).
// This mirrors the manual "Add a place" search flow (LocationInput.tsx: pick a
// geocode result, its canonicalName/lat/lng/countryCode REPLACE what the user
// typed) but runs server-side, once per resolved AI batch, right before the
// batch is submitted.
//
// Lives here (not under server/geocoding/) because it's batch-shaped AI
// pipeline policy — dedupe, parallelism, best-effort fallback — not a
// geocoding-provider concern; `geocoding/` stays a pure vendor seam.
import type { BatchableCommand, Location } from "@tc/contracts";
import type { Geocoder } from "@/server/geocoding";

type LocationCommand = Extract<BatchableCommand, { type: "AddActivity" | "UpdateActivity" }>;

// "Needs enrichment" = AddActivity/UpdateActivity with a `location` object
// present. UpdateActivity's `location: null` means "clear it" — nothing to
// geocode there — and `undefined` means "unchanged" on both command types.
function hasLocation(command: BatchableCommand): command is LocationCommand & { location: Location } {
  return (command.type === "AddActivity" || command.type === "UpdateActivity") && command.location != null;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

// One geocoder lookup, reduced to a Location. Best-effort: an empty match or a
// thrown/rejected lookup (vendor outage, missing key, rate limit) both fall
// back to the model's stated name with no coordinates — never propagated as a
// failure of the whole AI request.
async function geocodeOne(geocoder: Geocoder, name: string): Promise<Location> {
  try {
    const [first] = await geocoder.forward(name, { limit: 1 });
    return first
      ? { name: first.canonicalName, lat: first.lat, lng: first.lng, countryCode: first.countryCode }
      : { name };
  } catch {
    return { name };
  }
}

// Replaces `location` on every AddActivity/UpdateActivity command that has one
// with the geocoded result, mirroring the manual search flow exactly (the
// canonical name REPLACES the model's raw name). Identical place-name queries
// (case-insensitive, trimmed) within the batch are deduped to a single
// in-flight lookup, reused everywhere that name appears — real observed
// pattern ("Lunch in Rochester, NY" once per day of a multi-day trip) and a
// meaningful save against LocationIQ's free-tier daily cap. Every unique
// name's lookup runs in parallel (Promise.all), not serialized.
// `getGeocoder` is a thunk, not a resolved `Geocoder`, so the caller can defer
// its own construction cost (e.g. `getGeocoder()` from server/geocoding, which
// throws if LOCATIONIQ_API_KEY is unset) until we've actually confirmed there's
// something to geocode — it's only invoked below, after the size===0 early
// return, and at most once per call regardless of how many names need looking up.
export async function enrichCommandLocations(
  commands: BatchableCommand[],
  getGeocoder: () => Geocoder,
): Promise<BatchableCommand[]> {
  const namesByKey = new Map<string, string>();
  for (const command of commands) {
    if (!hasLocation(command)) continue;
    const key = normalize(command.location.name);
    if (!namesByKey.has(key)) namesByKey.set(key, command.location.name);
  }
  if (namesByKey.size === 0) return commands;

  const geocoder = getGeocoder();
  const entries = await Promise.all(
    Array.from(namesByKey.entries()).map(
      async ([key, name]) => [key, await geocodeOne(geocoder, name)] as const,
    ),
  );
  const geocodedByKey = new Map(entries);

  return commands.map((command) => {
    if (!hasLocation(command)) return command;
    const location = geocodedByKey.get(normalize(command.location.name));
    return location ? { ...command, location } : command;
  });
}
