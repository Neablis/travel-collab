// Mirrors the condition `server/auth.ts` uses to register the Google OAuth
// provider. It lives in src/lib, not src/server, for the same reason
// `devLogin.ts` does: UI is bound by the lint wall and may not import
// @/server/*, but a plain env read is not server internals. Read it in a
// server component and pass the boolean down as a prop — never import this
// from a "use client" module, where process.env is not populated.
export function isGoogleSignInAvailable(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}
