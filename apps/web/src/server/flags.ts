// Server-only, same rule as server/config.ts: never import this from UI code.
// Flag values reach the UI as props from a server component, never by a client
// component importing this module.
//
// DECLARATIONS ONLY: every export is a flag. The `aiLive()` accessor therefore lives
// in ai/modelSelection.ts. Import it from there; never re-export it from here.
//
// A flag is an environment variable (M59: no Flags service, no per-user
// targeting, no override cookie). Changing one is a redeploy or a restart of
// the container, which is the price of having nothing between the setting and
// the code that reads it. The read is per call, not at import, so a test or a
// restart sees the current value.

/** A flag, as a function that answers for this process. */
type EnvFlag = (() => Promise<boolean>) & { readonly key: string };

// Fails CLOSED, and "true" is the only value that turns a flag on: a typo, an
// empty string or an unset variable all land on off, which for `ai-live` is the
// simulated model, where nobody spends. `flags.test.ts` pins it.
//
// Who may open the operator console is deliberately NOT a flag here: a global
// boolean would make every signed-in caller an operator. It is per caller, from
// `ADMIN_USER_IDS` (`server/entitlements/admin.ts`).
function envFlag(key: string, variable: string): EnvFlag {
  const read = async () => process.env[variable] === "true";
  return Object.assign(read, { key });
}

// When off, POST /api/trips/:id/ask answers from the SIMULATED model: it
// emits real tool calls, the real read tools run, and the answer — or the
// proposal, or the composed page — is written from what they returned. No
// provider is contacted and no tokens are spent, and the response carries
// `x-tc-ai-simulated: true` so the client can badge it. Global to the process,
// and `AI_LIVE` (ai/modelSelection.ts) still overrides it for local and CI.
export const aiLiveFlag = envFlag("ai-live", "FLAG_AI_LIVE");
