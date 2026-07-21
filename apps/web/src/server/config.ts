// Server/tooling half of the dev config — never import from UI code
// (DATABASE_URL must not end up in a client bundle).
// No fallback: a missing DATABASE_URL should fail loudly, not silently
// connect to a local default that doesn't exist in preview/production.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to apps/web/.env.local for local dev.",
  );
}
export const DATABASE_URL = process.env.DATABASE_URL;

export const serverConfig = {
  locationIqApiKey: process.env.LOCATIONIQ_API_KEY ?? "",
  timezone: process.env.TRIP_TIMEZONE ?? "America/Los_Angeles",
};
