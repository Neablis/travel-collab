import * as Sentry from "@sentry/nextjs";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import type { NextAuthConfig } from "next-auth";
import { isDevLoginEnabled } from "@/lib/devLogin";

// Edge-safe Auth.js configuration (ADR-024, superseding ADR-023). This is
// deliberately just data: providers, callbacks, and the pages map — nothing
// here reaches into `@/server/*` or anything Node-only, so it is safe to
// import from the Edge runtime `apps/web/src/proxy.ts` runs in as well
// as from `apps/web/src/server/auth.ts`. This is Auth.js v5's own documented
// split-config shape for edge-compatible request interception: a shared config object,
// with each consumer building its own `NextAuth(authConfig)` instance rather
// than the proxy importing the server's live singleton.
//
// Moving this out of `src/server/auth.ts` makes it importable by genuine UI
// too, which is the one real cost of this restructure — closed by a
// `no-restricted-imports` rule in `apps/web/eslint.config.mjs` that forbids
// `@/lib/authConfig` from `src/components/**` and `src/app/**` (excluding
// `src/app/api/**`). Only `src/server/auth.ts` and `src/proxy.ts` may
// build an Auth.js instance from it.

// Dev-login identities are built to resemble a real Google one as closely as a
// password-less local provider can: a stable id, a display name, and an email
// address that is well-formed and — once AUTH_DEV_EMAIL_BASE points at a real
// inbox — actually deliverable.
//
// The email is the point. Google sign-in always yields one; dev login yielding
// none meant every email-shaped feature was untestable end to end, and that
// gap — not a considered trade-off — is what ADR-026 leaned on when it made an
// invite's email a label rather than something checked at accept time. Closing
// it lets that decision be revisited on its merits later.
//
// Plus-addressing is what makes one inbox serve every dev user: `base+alice@`
// and `base+bob@` are distinct addresses that both deliver to `base@`, so
// invite mail can actually be received and read. Set AUTH_DEV_EMAIL_BASE to
// your own address to receive it.
//
// The fallback is the RFC 2606 reserved `example.com`, which is undeliverable
// by design: it keeps every dev identity well-formed with the var unset (the
// charset check below is the only thing that has to hold for sign-in to work),
// while making it obvious that no mail is going anywhere until someone opts
// in. It used to be a maintainer's personal address checked into the repo
// (project review, PR #71 §7) — a default that silently sends invite mail to
// one specific human on any deployment that forgets to set the var.
const DEV_EMAIL_BASE = process.env.AUTH_DEV_EMAIL_BASE ?? "dev@example.com";

// Letters, digits, `-` and `_` only. This is what makes the address above
// well-formed rather than cosmetic: a username carrying whitespace or `@`
// would build something that is not an email at all, and `normalizeIdentity`
// would then store rubbish against a durable user row (ADR-025). Bounded
// length for the same reason — an address has a practical ceiling.
const DEV_USERNAME = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * A dev-login username → the identity Auth.js hands to the `signIn` callback.
 *
 * Pure and exported so it can be tested directly: the provider below is
 * awkward to invoke, and the interesting behaviour (what is rejected, and what
 * address a name produces) is entirely here.
 *
 * Returns null for anything the charset rejects, which Auth.js turns into a
 * failed sign-in and the designed `/signup?error=` screen.
 */
export function devLoginIdentity(
  raw: unknown,
): { id: string; name: string; email: string } | null {
  // Lowercased BEFORE anything derives from it. `normalizeIdentity` lowercases
  // the email, but `id` is what `actor_id` and every membership row carry, so
  // casing alone used to mint two people: "Alice" got `dev-Alice` and "alice"
  // got `dev-alice`, and the second one did not inherit the first one's trips
  // (CodeRabbit, PR #71).
  const username = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!DEV_USERNAME.test(username)) return null;
  // Exactly one `@`, with non-empty whitespace-free parts either side.
  // `lastIndexOf` accepted `ops@` (empty domain) and
  // `ops@internal@example.com` (two `@`), either of which builds a string that
  // is not an address and would then be stored against a durable user row
  // (CodeRabbit, PR #70). A misconfigured base fails the sign-in rather than
  // minting a malformed identity.
  const parts = DEV_EMAIL_BASE.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts as [string, string];
  if (local === "" || domain === "" || /\s/.test(DEV_EMAIL_BASE)) return null;
  return {
    id: `dev-${username}`,
    name: username,
    // Already canonical above, so "Alice" and "alice" converge on one
    // identity — id, name and address alike.
    email: `${local}+${username}@${domain}`,
  };
}

/**
 * Which deployment environment minted (or is reading) a session token.
 *
 * Exists because Preview and Production **share one `AUTH_SECRET`** — one
 * variable scoped to both in the Vercel dashboard — and sessions here are
 * stateless JWTs with no adapter. A token signed anywhere therefore verifies
 * everywhere, and `AUTH_DEV_LOGIN=true` is set on Preview, where the
 * credentials provider accepts ANY username with no password and yields
 * `dev-<name>` — an identity that post-M11 inherits real trip memberships.
 * Lifting a preview-minted cookie onto `caesura.today` was, until this claim
 * existed, a working sign-in as that member. Deployment Protection on
 * previews was the only thing in the way, and that is a fence, not a check.
 *
 * The sharing is not incidental and cannot simply be undone: Auth.js's
 * redirect proxy (`AUTH_REDIRECT_PROXY_URL`, the fix for KI-50) encrypts the
 * OAuth `state` with this same secret and requires the proxy and the
 * originating deployment to agree on it. So the secret stays shared and the
 * *token* carries the environment instead — which is the second of the two
 * options the 2026-08-28 project review left open under M3, and the one that
 * does not require giving up dev login on previews.
 *
 * `VERCEL_ENV` is set by Vercel and never by us — the same property
 * `isDevLoginEnabled()` leans on — so a deployment cannot lie about which
 * environment it is. Unset off-Vercel, where "development" covers local dev,
 * `pnpm check` and the Playwright lane alike; those mint and read their own
 * tokens within one process, so the value only has to be stable, not
 * meaningful.
 */
export function authEnvironment(): string {
  return process.env.VERCEL_ENV ?? "development";
}

const providers: Provider[] = [];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

// Gate shared with the sign-in/sign-up pages rather than repeated here: the
// username box and the provider backing it must never disagree. See
// `lib/devLogin.ts` for why the gate needs a VERCEL_ENV clause on top of the
// opt-in (project review M1).
if (isDevLoginEnabled()) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev Login",
      credentials: { username: { label: "Username" } },
      authorize: async (credentials) => devLoginIdentity(credentials?.username),
    }),
  );
}

export const authConfig: NextAuthConfig = {
  providers,
  // M15: our screens replace Auth.js's default sign-in page. `error` points
  // at the same route so a failed or declined Google grant comes back to a
  // designed screen carrying `?error=<code>` rather than Auth.js's own error
  // page. AuthScreen renders that code as human copy.
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    // Called with `user` exactly once, on sign-in; with the decoded token
    // alone on every subsequent session read, in both runtimes.
    jwt: ({ token, user }) => {
      if (user) {
        if (user.id) token.userId = user.id;
        // Stamped at mint time, so the claim describes where the credential
        // was actually issued rather than where it is being presented.
        token.env = authEnvironment();
        return token;
      }
      // Returning null is Auth.js's own "this session is over" signal: it
      // clears the session cookie and answers with no session
      // (`@auth/core/lib/actions/session.js` — `sessionStore.clean()`), so a
      // cross-environment token is discarded rather than merely ignored.
      //
      // A token with NO claim fails this too, deliberately. Tokens minted
      // before this shipped are exactly the ones whose origin we cannot
      // establish, so they are the ones the check exists for. The cost is one
      // forced re-sign-in for anyone holding a live session when this
      // deploys; the alternative — trusting an unstamped token — would leave
      // the hole open for the 30-day life of every cookie already issued.
      if (token.env !== authEnvironment()) return null;
      return token;
    },
    session: ({ session, token }) => {
      session.user.id = (token.userId as string | undefined) ?? token.sub ?? "";
      // Overrides `sendDefaultPii: false` deliberately (Mitchell, 2026-08-30):
      // this is the one seam every `auth()` call in both runtimes passes
      // through, so it's the single place to attach identity to whatever
      // Sentry client is live for that invocation rather than repeating the
      // call at every route.
      if (session.user.id) {
        Sentry.setUser({ id: session.user.id, email: session.user.email ?? undefined });
      }
      return session;
    },
  },
};
