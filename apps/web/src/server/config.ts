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

// One literal, read by both model ids below, so "the classifier uses the same
// model as the answer unless told otherwise" holds by construction rather than
// by two copies of a string that can drift.
const DEFAULT_AI_MODEL = "anthropic/claude-haiku-4-5";

export const serverConfig = {
  locationIqApiKey: process.env.LOCATIONIQ_API_KEY ?? "",
  aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? DEFAULT_AI_MODEL,
  // The pre-turn intent classifier's model (askIntent.ts). Falls through to
  // AI_MODEL, not to the literal: setting AI_MODEL alone must move both, so
  // nothing about today's behaviour changes until AI_CLASSIFIER_MODEL is set
  // deliberately. The two jobs are genuinely different sizes — one binary
  // verdict against a 15-tool planning turn — but which model is cheapest at
  // the small one is a tuning call to make against live records, not a default
  // to guess at.
  aiClassifierModel: process.env.AI_CLASSIFIER_MODEL ?? process.env.AI_MODEL ?? DEFAULT_AI_MODEL,
};
