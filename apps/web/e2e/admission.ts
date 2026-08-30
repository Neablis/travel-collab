// The one string the e2e lane's server and its specs both have to know.
//
// M11a puts an invite gate in front of every account that has no `users` row,
// and the build plan's decision 3 routes dev login through it rather than
// exempting it — deliberately, for evidence: KI-50 blocks a Google OAuth walk
// from an unregistered preview host, so this lane is the only place any
// admission path can be proven automatically. Every dev user the suite signs
// in (alice in `auth.setup.ts`, bob/carol/dan in `m11-invites.spec.ts`, the
// throwaways in `m11a-invite-gate.spec.ts`) is brand new against a fresh
// database, so without a credential the whole suite would fail at setup.
//
// `playwright.config.ts` puts this in `webServer.env` as `INVITE_SUPER_CODE`
// and the specs present it through the `/signup` form, so the two cannot
// drift. Deliberately dependency-free — the config imports it at load time.
//
// **Local caveat:** `webServer.reuseExistingServer` is `!CI`, so on the dev
// lane an already-running `pnpm dev` keeps whatever `INVITE_SUPER_CODE` it was
// started with (the same trap KI-25 documents for `AI_LIVE`). `ci-like` sets
// `CI=true` and always starts its own server, which is the lane that counts.
export const E2E_SUPER_CODE = "e2e-super-code-not-a-secret";
