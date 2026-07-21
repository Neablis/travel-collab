// Server/tooling half of the dev config — never import from UI code
// (the DATABASE_URL default must not end up in a client bundle).
export const POSTGRES_PORT = Number(process.env.POSTGRES_PORT ?? 5433);
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  `postgres://postgres:postgres@localhost:${POSTGRES_PORT}/travel`;

export const serverConfig = {
  locationIqApiKey: process.env.LOCATIONIQ_API_KEY ?? "",
  timezone: process.env.TRIP_TIMEZONE ?? "America/Los_Angeles",
  aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "anthropic/claude-haiku-4-5",
};
