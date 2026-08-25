// Preview-only "Reset to demo data" gate, shared by the route
// (POST /api/dev/reset-demo-data) and AppHeader (the menu item's visibility).
// A hidden menu item is not a permission — the route re-checks this itself
// rather than trusting the header's prop, so posting to the URL directly
// gets the same 404 as not seeing the button at all.
//
// Lives in src/lib rather than src/server so AppHeader (src/components, a
// server component but still bound by the UI/server lint wall's "no
// @/server/* import" rule, apps/web/eslint.config.mjs:38) can call it
// directly — it's a plain env-var read, no I/O, so it doesn't need the
// src/server boundary.
//
// Both env vars, both required, fails closed on anything else — same shape
// as aiLive()'s AI_LIVE check (src/server/ai/modelSelection.ts): a typo or
// an unset var resolves to false, never true. VERCEL_ENV is set by Vercel
// itself (never by us), so production can never satisfy this — only
// "preview" does, and only with the operator's own SEED_DEMO_DATA opt-in on
// top of it.
export function isDemoDataResetEnabled(): boolean {
  return process.env.VERCEL_ENV === "preview" && process.env.SEED_DEMO_DATA === "true";
}
