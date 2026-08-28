// The single gate on the password-less "dev-login" credentials provider —
// read here by the sign-in/sign-up pages (to decide whether to show the
// username box) and by `lib/authConfig.ts` itself (to decide whether to
// register the provider at all). One function, not two mirrored conditions:
// the page's box and the provider must never disagree about whether dev
// login exists.
//
// It lives in src/lib, not src/server, for the same reason `demoDataReset.ts`
// does: UI is bound by the lint wall and may not import @/server/*, but a
// plain env read is not server internals. Read it in a server component and
// pass the boolean down as a prop — never import this from a "use client"
// module, where process.env is not populated.
//
// Both conditions required, fails closed — same shape as
// `isDemoDataResetEnabled()`. AUTH_DEV_LOGIN is the operator's opt-in;
// VERCEL_ENV is set by Vercel itself and never by us, so a production
// deployment cannot satisfy this however the opt-in was scoped. That second
// clause is the whole point (project review M1): the provider accepts ANY
// username with no password and yields `dev-${name}`, and post-M11 a dev
// user inherits real trip memberships — so one env var scoped to "All
// Environments" by mistake used to mean production accepted credential-less
// sign-in as an existing member. `.env.example` saying "NEVER set in
// production" is documentation, not enforcement.
//
// Deliberately `!== "production"` rather than `=== "preview"` (which is what
// the demo-reset gate wants): VERCEL_ENV is unset outside Vercel, and local
// development is dev login's primary use case.
export function isDevLoginEnabled(): boolean {
  return process.env.AUTH_DEV_LOGIN === "true" && process.env.VERCEL_ENV !== "production";
}
