import NextAuth from "next-auth";
import { authConfig } from "@/lib/authConfig";

// The full server-side Auth.js instance, built from the shared edge-safe
// config in `@/lib/authConfig` (ADR-024). Exported names are unchanged from
// before the split — many modules depend on them.
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
