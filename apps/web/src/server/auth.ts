import NextAuth from "next-auth";
import { authConfig } from "@/lib/authConfig";
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
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: { ...authConfig.callbacks, signIn: recordSignIn },
});
