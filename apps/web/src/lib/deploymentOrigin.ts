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
// **On a preview the BRANCH url comes first, and getting that wrong took the
// console down.** The first version of this went straight to `VERCEL_URL`,
// which is the per-deployment host (`travel-collab-<hash>-<team>.vercel.app`)
// — not the host anybody browses. A preview is reached through the branch
// alias, Vercel's Deployment Protection issues its `_vercel_jwt` cookie for
// THAT host, and `app/admin/page.tsx` forwards the caller's cookie header
// verbatim. Sent to the deployment host, that cookie does not match, the
// request is challenged rather than served, and Vercel rate-limits the
// challenge: the self-fetch came back `429` and the page turned it into a 500.
//
// The comment here used to call that failure an acceptable edge case — "a host
// this deployment genuinely serves but which is in neither variable — a branch
// alias, say — now fails loudly". That reasoning was wrong in a way worth
// keeping visible: on a preview the branch alias is not an edge case, it is the
// only case, so "fails loudly" meant every operator page load on every preview.
// A trade-off written down is not the same as a trade-off that was measured.
//
// `VERCEL_BRANCH_URL` is still CONFIGURATION — Vercel sets it on the
// deployment, no client can write it — so the security property the previous
// change bought is unchanged. It is the same host the old header-derived code
// arrived at, reached from a source a request cannot forge.
export function deploymentOrigin(): string {
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  // The branch alias: stable per branch, and the host a preview is actually
  // served on, so a forwarded protection cookie still matches.
  if (process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`;
  // A deployment with no branch alias (a direct `vercel deploy`) still answers
  // on its own URL.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.WEB_PORT ?? "3001"}`;
}
