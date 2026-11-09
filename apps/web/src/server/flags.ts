// Server-only, same rule as server/config.ts: never import this from UI code.
// Flag values reach the UI as props from a server component, never by a client
// component importing this module.
//
// DECLARATIONS ONLY: every export is a flag, and `flags.test.ts` enumerates the
// module to check each one fails closed. The `aiLive()` accessor therefore lives
// in ai/modelSelection.ts. Import it from there; never re-export it from here.
//
// A flag is an environment variable (M59: no Flags service, no per-user
// targeting, no override cookie). Changing one is a redeploy or a restart of
// the container, which is the price of having nothing between the setting and
// the code that reads it. The read is per call, not at import, so a test or a
// restart sees the current value.

/** A flag, as a function that answers for this process. */
type EnvFlag = (() => Promise<boolean>) & { readonly key: string; readonly defaultValue: false };

// `defaultValue: false` is deliberate and fails CLOSED, and "true" is the only
// value that turns a flag on: a typo, an empty string or an unset variable all
// land on off. For `ai-live` off is the simulated model and nobody spends; for
// `admin-console` off is "not an operator". `flags.test.ts` pins both.
function envFlag(key: string, variable: string): EnvFlag {
  const read = async () => process.env[variable] === "true";
  return Object.assign(read, { key, defaultValue: false as const });
}

// When off, POST /api/trips/:id/ask answers from the SIMULATED model: it
// emits real tool calls, the real read tools run, and the answer — or the
// proposal, or the composed page — is written from what they returned. No
// provider is contacted and no tokens are spent, and the response carries
// `x-tc-ai-simulated: true` so the client can badge it. Global to the process,
// and `AI_LIVE` (ai/modelSelection.ts) still overrides it for local and CI.
export const aiLiveFlag = envFlag("ai-live", "FLAG_AI_LIVE");

// **Who may open the operator console without a stored bit** (M20 link 7). Now
// global rather than per user: when on, every signed-in caller is an operator,
// so it is a break-glass setting, not a way to name one person. Naming people
// is `ADMIN_USER_IDS` or the `users.is_admin` column, which is what the console
// shows.
//
// **This does not make entitlement a flag.** ADR-019's 2026-08-25 amendment
// declines that: a paid tier is a database fact (plan version, pinned purchase,
// audit trail). `is_admin` is none of those. A capability a customer pays for
// still may not live here.
//
// It only ever WIDENS. `users.is_admin` stays the durable fact; taking admin
// away is clearing the column and leaving this off.
export const adminConsoleFlag = envFlag("admin-console", "FLAG_ADMIN_CONSOLE");
