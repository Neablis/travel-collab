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
  // **The tier map: three named slots, each an INPUT** (ADR-043 decision 4,
  // spec §5b). Mitchell, 2026-09-10: *"that cost is not forever, and the model
  // we use might change, so that needs to be a variable input in the system."*
  //
  // `cheap | mid | strong` are the names of slots, not models. The kernel names
  // a slot; this is the only place a slot becomes an id. Every one of them
  // still resolves through `selectAiModel()`, so ADR-019's chokepoint, its lint
  // wall and the kill switch are untouched.
  //
  // **Each falls through to `AI_MODEL`, not to the literal** — the same rule
  // `aiClassifierModel` above already follows, and for the same reason. With
  // none of the three set, all three resolve to exactly the model that answers
  // today, so tiering changes no behaviour until a deployment opts into it.
  // Setting `AI_MODEL` alone still moves everything.
  //
  // Open, and deliberately not decided here (spec §5b): whether this should be
  // a Vercel Flag rather than three environment variables, which would allow a
  // swap without a redeploy during a provider incident. The map is built as one
  // resolved value either way, so whichever source feeds it is this object's
  // implementation and not a change to anything that reads it.
  aiModelTiers: {
    cheap: process.env.AI_MODEL_CHEAP ?? process.env.AI_MODEL ?? DEFAULT_AI_MODEL,
    mid: process.env.AI_MODEL_MID ?? process.env.AI_MODEL ?? DEFAULT_AI_MODEL,
    strong: process.env.AI_MODEL_STRONG ?? process.env.AI_MODEL ?? DEFAULT_AI_MODEL,
  },
};
