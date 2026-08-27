import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import type { NextAuthConfig } from "next-auth";

// Edge-safe Auth.js configuration (ADR-024, superseding ADR-023). This is
// deliberately just data: providers, callbacks, and the pages map — nothing
// here reaches into `@/server/*` or anything Node-only, so it is safe to
// import from the Edge runtime `apps/web/src/middleware.ts` runs in as well
// as from `apps/web/src/server/auth.ts`. This is Auth.js v5's own documented
// split-config shape for edge-compatible middleware: a shared config object,
// with each consumer building its own `NextAuth(authConfig)` instance rather
// than middleware importing the server's live singleton.
//
// Moving this out of `src/server/auth.ts` makes it importable by genuine UI
// too, which is the one real cost of this restructure — closed by a
// `no-restricted-imports` rule in `apps/web/eslint.config.mjs` that forbids
// `@/lib/authConfig` from `src/components/**` and `src/app/**` (excluding
// `src/app/api/**`). Only `src/server/auth.ts` and `src/middleware.ts` may
// build an Auth.js instance from it.

// Dev-login identities are built to resemble a real Google one as closely as a
// password-less local provider can: a stable id, a display name, and a REAL,
// deliverable email address.
//
// The email is the point. Google sign-in always yields one; dev login yielding
// none meant every email-shaped feature was untestable end to end, and that
// gap — not a considered trade-off — is what ADR-026 leaned on when it made an
// invite's email a label rather than something checked at accept time. Closing
// it lets that decision be revisited on its merits later.
//
// Plus-addressing is what makes one inbox serve every dev user: `base+alice@`
// and `base+bob@` are distinct addresses that both deliver to `base@`, so
// invite mail can actually be received and read. Overridable by env so a
// second developer is not stuck with the first one's inbox.
const DEV_EMAIL_BASE = process.env.AUTH_DEV_EMAIL_BASE ?? "neablis121@gmail.com";

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
 * failed sign-in and the designed `/signin?error=` screen.
 */
export function devLoginIdentity(
  raw: unknown,
): { id: string; name: string; email: string } | null {
  const username = typeof raw === "string" ? raw.trim() : "";
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
    // Lowercased downstream by `normalizeIdentity` (ADR-025), so "Alice" and
    // "alice" converge on one address the way two spellings of a real one do.
    email: `${local}+${username}@${domain}`,
  };
}

const providers: Provider[] = [];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

if (process.env.AUTH_DEV_LOGIN === "true") {
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
    jwt: ({ token, user }) => {
      if (user?.id) token.userId = user.id;
      return token;
    },
    session: ({ session, token }) => {
      session.user.id = (token.userId as string | undefined) ?? token.sub ?? "";
      return session;
    },
  },
};
