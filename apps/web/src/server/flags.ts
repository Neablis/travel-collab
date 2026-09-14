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

// **Who may open the operator console, without a redeploy** (M20 link 7,
// Mitchell 2026-09-14: *"add me also using feature flags to turn on admin for
// accounts so I don't need a redeploy"*).
//
// **This does not make entitlement a flag, and the distinction is the whole
// reason this is allowed to exist.** ADR-019's 2026-08-25 amendment declines to
// assume a paid tier is a flag — *"a paid tier is more likely a database fact
// than a flag value"* — and M20 built it as one: a plan version, a pinned
// purchase, an audit trail, money behind it. **`is_admin` is none of those.**
// Nobody buys it, nothing pins it, no version records what it granted, and it
// confers no capability a plan sells. It is an operator bit on a staff account,
// which is exactly the shape a targeting rule is for. **A capability a customer
// pays for still may not live here.**
//
// **`defaultValue: false`, and every failure answers `false`.** Unlike
// `ai-live`, where off is "simulated" and the product still works, off here is
// simply "not an operator" — so there is no tension between failing closed and
// staying useful. An unreachable Flags service, an unconfigured adapter (which
// is the ordinary case locally, where `vercelAdapter()` has no Edge Config),
// and an `identify` that throws all land on the same answer. The catch that
// covers the last of those is `adminConsoleFlagForCaller()`, because the SDK
// runs `identify` BEFORE the code path that applies `defaultValue` — the same
// hole `aiLive()` catches for `ai-live`.
//
// **It only ever WIDENS.** `users.is_admin` stays the durable fact and is what
// the console displays; this is a second way to say yes, never a way to say no.
// Taking admin away is clearing the column, not removing a rule — otherwise a
// Flags outage would silently revoke every operator, and "the console is empty
// today" is not a message anyone would read as an outage.
//
// The rule is written against `user.email` (`server/flagEntities.ts`), so
// turning admin on for somebody is one dashboard rule and no deploy:
//   vercel flags rules add admin-console --environment production \
//     --if 'user.email eq "mitchell@example.com"' --then true
export const adminConsoleFlag = flag<boolean, FlagEntities>({
  key: "admin-console",
  description:
    "When on for the caller, they may open /admin and every admin endpoint. Widens users.is_admin; never narrows it. Targetable per user.",
  options: [
    { label: "Not an operator", value: false },
    { label: "Operator", value: true },
  ],
  defaultValue: false,
  adapter: vercelAdapter(),
  identify: identifyFlagEntities,
});
