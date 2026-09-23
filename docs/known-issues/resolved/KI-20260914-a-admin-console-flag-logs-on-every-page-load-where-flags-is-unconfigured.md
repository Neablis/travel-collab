### KI-2026-09-14-a — the `admin-console` flag warns once per page load anywhere Flags is not configured

- **Severity:** noise, not behaviour. The flag falls back to `defaultValue: false` — which is the fail-closed answer and the correct one — and every gate keeps working. What is wrong is that the SDK says so out loud, repeatedly, in the one place a developer is reading output.
- **Area:** `apps/web/src/server/flags.ts` (`adminConsoleFlag`), read by `callerIsAdmin()` in `apps/web/src/server/entitlements/admin.ts`, reached on every `GET /api/account/preferences`.
- **What is wrong:** with no flag definitions available — local dev, CI, and any deployment without Flags set up — `@vercel/flags-core` logs `Flag "admin-console" is falling back to its defaultValue after catching the following error … No flag definitions available` on **every evaluation**. `/api/account/preferences` is hit twice per page load (`PreferencesProvider` and `AccountMenu`'s `fetchIsAdmin`), and the column is checked first, so the flag is evaluated for every **non**-admin — which is everybody, in exactly the environments where it cannot work.
- **How it came to light:** `pnpm --filter web test:e2e:ci-like m20-entitlements m11-invites` on 2026-09-14, immediately after the flag landed. Ten tests passed and the server log carried the warning dozens of times. Worth keeping as evidence rather than only as noise: it is the fail-closed path being exercised for real in a deployment, which no unit test can show.
- **Why not fixed when it was found:** every fix considered introduces a worse failure than the one it removes.
  - **Gate the evaluation on `process.env.VERCEL`.** Matches repo precedent (`warnIfVercelOverride`, `isDemoDataResetEnabled`) and is one line — but it means a deployment that is not Vercel, with Flags genuinely configured, silently stops honouring the flag. A control that quietly stops working is worse than a log line, and it would be found the day somebody could not get into the console.
  - **Cache the "no definitions" outcome after the first call.** Would work, and cannot be written: the SDK *returns* `defaultValue` rather than throwing on that path, so the caller cannot tell "not configured" from "configured, and the answer is no".
  - **Stop calling it from `/api/account/preferences`.** Kills most of the volume, and takes the console's menu item away from a flag-only operator — which is half of what the flag was added for.
- **Scope:** if it is worth fixing, the honest shape is a positive signal that Flags is configured at all — one env read the adapter already depends on — consulted before evaluating, so an unconfigured deployment skips the call and a configured one is unchanged. That needs checking against `@flags-sdk/vercel`'s actual configuration surface rather than guessed at, which is why it is not a line in the change that found it.
- **RESOLVED 2026-09-23, by the shape this entry asked for.** The entry's own
  scope line was: *"a positive signal that Flags is configured at all — one env
  read the adapter already depends on — consulted before evaluating, so an
  unconfigured deployment skips the call and a configured one is unchanged.
  That needs checking against `@flags-sdk/vercel`'s actual configuration
  surface rather than guessed at."*

  **Checked, in the installed packages.** `@flags-sdk/vercel@1.4.7` reads no
  environment of its own — `grep` over its `dist` finds no `process.env` at
  all. It delegates to `@vercel/flags-core@1.8.0`, whose default client is
  built by **`createClient(process.env.FLAGS)`**. Without it there is no auth,
  so `resolveDataWithFallbacks` exhausts stream, polling, a provided datafile,
  bundled definitions and a one-time fetch, and throws — which is the log line
  this entry is about.

  So `adminConsoleFlagForCaller()` now asks `process.env.FLAGS` before
  evaluating. Measured on `m6-optimistic`, same spec, same lane
  (`CI=true`, production build): **9 warnings → 0**, 3 passed both times.

  **Why this is not the `process.env.VERCEL` gate this entry rejected**, which
  is the only question worth asking about it. That rejection stands and is
  right: *"a deployment that is not Vercel, with Flags genuinely configured,
  silently stops honouring the flag. A control that quietly stops working is
  worse than a log line."* `VERCEL` is a **proxy** for "probably configured"
  and can be wrong in both directions. `FLAGS` is the credential the SDK
  itself requires, so its absence is not evidence that the flag is inert — it
  is the definition of inert. A non-Vercel deployment with Flags configured
  has `FLAGS` set and is completely unaffected, and `adminFlag.int.test.ts`
  pins exactly that case ("still honours the flag as soon as the credential is
  present") beside the new one.

  **The second rejected option is also answered.** This entry ruled out
  caching the "no definitions" outcome because *"the SDK RETURNS `defaultValue`
  rather than throwing on that path, so the caller cannot tell 'not
  configured' from 'configured, and the answer is no'"*. True, and irrelevant
  now: the question is asked BEFORE the SDK is reached, where the two are
  trivially distinguishable.

  **What did NOT change:** the flag still only ever widens, still fails closed,
  and `users.is_admin` is still the durable fact read first. The three existing
  `adminFlag.int.test.ts` cases are unchanged in meaning — they now set `FLAGS`
  in `beforeEach`, because they are about a CONFIGURED deployment and were
  previously passing for a reason the environment supplied by accident.

  **Not applied to `ai-live`.** `aiLive()` has the same shape, but it is not
  hot — nothing evaluates it twice per page load — so it emits no volume worth
  a change, and widening this beyond what was measured is how a targeted fix
  becomes a refactor.

- **First noted:** 2026-09-14, adding the `admin-console` flag (M20 link 7).
