// Server-only, same rule as server/config.ts: never import this from UI code.
// Flag values reach the UI as props from a server component, never by a client
// component importing this module.
//
// DECLARATIONS ONLY. `getProviderData(flags)` in the discovery endpoint
// enumerates this module's exports and expects every one to be a flag
// definition — an exported helper function would be skipped at best and throw
// at worst. The `aiLive()` accessor therefore lives in ai/modelSelection.ts,
// and `identifyFlagEntities` in server/flagEntities.ts. Import them here; never
// re-export them from here.
import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";
import { identifyFlagEntities, type FlagEntities } from "@/server/flagEntities";

// When false, POST /api/trips/:id/ask answers from the SIMULATED model: it
// emits real tool calls, the real read tools run, and the answer — or the
// proposal, or the composed page — is written from what they returned. No
// provider is contacted and no tokens are spent, and the response carries
// `x-tc-ai-simulated: true` so the client can badge it.
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
//
// `identify` is what makes this flag TARGETABLE rather than global: it hands
// Vercel the caller's id, email and email domain, so a dashboard rule can serve
// "Live" to named people while everyone else keeps getting the simulated model.
// The attributes, and why exactly these three, are in server/flagEntities.ts.
//
// Targeting only ever WIDENS who gets live AI. A caller no rule matches — a
// signed-out one included, since `identify` then publishes no `user` at all —
// falls through to the flag's dashboard default, so that default must stay
// "Simulated" for the kill switch to still be a kill switch. That is a
// configuration this file cannot enforce; it is stated in
// docs/guidelines/environments-and-deploys.md next to the commands that set it.
//
// It does not weaken failing closed. `identify` runs BEFORE the SDK's
// defaultValue machinery, so a throw from it escapes this flag entirely — and
// is caught one level up by `aiLive()`, which answers `false`. Off is still the
// answer to every question this flag cannot resolve.
export const aiLiveFlag = flag<boolean, FlagEntities>({
  key: "ai-live",
  description:
    "When off, /api/trips/:id/ask answers from the simulated model instead of calling a real one. Targetable per user.",
  options: [
    { label: "Simulated", value: false },
    { label: "Live", value: true },
  ],
  defaultValue: false,
  adapter: vercelAdapter(),
  identify: identifyFlagEntities,
});
