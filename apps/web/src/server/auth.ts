import NextAuth, { type Session } from "next-auth";
import { authConfig, createJwtCallback, type SessionWithMfa } from "@/lib/authConfig";
import { mfaStateFor, readSecondFactorProof } from "./mfa/state";
import { recordSignIn } from "./users";

// The full server-side Auth.js instance, built from the shared proxy-safe
// config in `@/lib/authConfig` (ADR-024). Exported names are unchanged from
// before the split — many modules depend on them.
//
// The `signIn` callback is added here rather than in `authConfig` on purpose
// (ADR-024, ADR-025): it writes to Postgres, and `authConfig` is what
// `src/proxy.ts` builds its own instance from, which ADR-024 keeps free of the
// database. Composing it at this seam keeps the database out of that
// instance entirely — the proxy still reads the JWT and touches nothing.
// This is also the only place it can live and still run once per sign-in: the
// `jwt` callback in `authConfig` runs on every session read, in both instances.
// The `jwt` callback is the exception that proves it: M62 composes it here too,
// because the epoch check needs a read the proxy's instance must not make.
const nextAuth = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    signIn: recordSignIn,
    // The same callback with the database behind it (ADR-092): the epoch check
    // and the second factor, which the proxy's database-free copy cannot do.
    jwt: createJwtCallback({
      stateFor: mfaStateFor,
      secondFactorFrom: (userId, sid, payload, epoch) => readSecondFactorProof(userId, sid, payload, epoch, new Date()),
    }),
  },
});

export const { handlers, signIn, signOut } = nextAuth;

/**
 * The session, including one that has passed Google and not yet the account's
 * second factor. Only the routes that complete that step may ask for it
 * (`/api/mfa/verify`); everything else wants `auth()` below.
 */
export async function authIncludingPending(): Promise<Session | null> {
  return nextAuth.auth();
}

/**
 * The signed-in session, or null.
 *
 * **A half-signed-in session is null here** (M62, ADR-092). The proxy turns it
 * away from pages, but it does not match `/api/*`, and every route there asks
 * this function who is calling. Refusing it here, once, is what keeps an account
 * with a second factor from being read through the API by someone who holds only
 * its Google session; no route repeats the check, so none can forget it. Sign-out
 * is Auth.js's own handler, which never comes through here.
 */
export async function auth(): Promise<Session | null> {
  const session = await authIncludingPending();
  return (session as SessionWithMfa | null)?.mfaPending ? null : session;
}
