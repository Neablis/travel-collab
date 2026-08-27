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
      authorize: async (credentials) => {
        const username = typeof credentials?.username === "string" ? credentials.username.trim() : "";
        if (!username) return null;
        return { id: `dev-${username}`, name: username };
      },
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
