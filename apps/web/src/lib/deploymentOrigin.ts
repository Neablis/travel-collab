// **Where this deployment answers**, from configuration rather than from a
// request header.
//
// Vercel's documented hierarchy, written out rather than left to a framework
// default: the production domain in production, the deployment's own URL on a
// preview (so a shared preview link resolves against something that exists),
// localhost otherwise. `src/app/layout.tsx` has carried this since M18 for
// `metadataBase`; it lives here now because a second caller needs it and two
// copies of an origin rule drift.
//
// **The second caller is why this is a shared module rather than a constant.**
// `app/admin/page.tsx` fetches its own API and forwards the caller's session
// cookie, and it used to build that URL from the incoming `host` and
// `x-forwarded-proto` headers. Both are request input. On Vercel the edge sets
// them and a forged host does not route to this function at all, so it was not
// exploitable there — but that is an infrastructure guarantee standing in for a
// code one, and the thing being sent is an operator's session cookie. Flagged
// by CodeRabbit on PR #174; the fix is to stop deriving a credential-bearing
// destination from anything a client can write.
//
// The trade is stated rather than hidden: a host this deployment genuinely
// serves but which is in neither variable — a branch alias, say — now fails
// loudly on an operator tool instead of silently forwarding a cookie somewhere
// this code cannot vouch for. That is the right direction for the one surface
// where the credential is an operator's.
export function deploymentOrigin(): string {
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.WEB_PORT ?? "3001"}`;
}
