// Server-only, same rule as server/config.ts: never import this from UI code.
// Flag values reach the UI as props from a server component, never by a client
// component importing this module.
//
// DECLARATIONS ONLY. `getProviderData(flags)` in the discovery endpoint
// enumerates this module's exports and expects every one to be a flag
// definition — an exported helper function would be skipped at best and throw
// at worst. The `aiLive()` accessor therefore lives in ai/modelSelection.ts.
import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

// When false, POST /api/trips/:id/ai returns a SIMULATED plan: a canned model
// emits tool calls, the real pipeline applies them, and the response carries
// `simulated: true`. No provider is contacted and no tokens are spent.
//
// `defaultValue: false` is deliberate and fails CLOSED — an unreachable Flags
// service degrades to simulated, never to spending. The Flags SDK uses
// defaultValue whenever `decide` returns undefined OR throws, adapter errors
// included, so this covers the outage case as well as the unconfigured one.
//
// No `decide` here on purpose: the SDK treats an explicitly provided `decide`
// as an OVERRIDE of the adapter, and returning `undefined` from it falls to
// `defaultValue` rather than through to the adapter. So a "check the env var,
// else ask Vercel" decide is not expressible — that override lives one level
// up, in aiLive().
export const aiLiveFlag = flag<boolean>({
  key: "ai-live",
  description:
    "When off, /api/trips/:id/ai returns a simulated plan instead of calling a model.",
  options: [
    { label: "Simulated", value: false },
    { label: "Live", value: true },
  ],
  defaultValue: false,
  adapter: vercelAdapter(),
});
