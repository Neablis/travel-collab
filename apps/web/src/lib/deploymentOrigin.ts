// **Where this deployment answers**, from configuration rather than from a
// request header.
//
// Vercel's documented hierarchy, written out rather than left to a framework
// default: the production domain in production, the branch alias on a preview,
// the deployment's own URL for a deployment that has no alias, localhost
// otherwise.
//
// **One caller today — `app/layout.tsx`'s `metadataBase`** — and the module
// survives its second one, which is worth recording because the second caller
// is why it exists. `app/admin/page.tsx` used to render by fetching its own API
// and forwarding the operator's session cookie, and this file was extracted so
// that the destination came from configuration instead of from `host` and
// `x-forwarded-proto` (CodeRabbit, PR #174). The console reads the Entitlements
// module directly now — `src/app/admin/**` is on the lint wall's exempt shell —
// so there is no cookie, no second request and no origin to get wrong on that
// path at all. This stayed because `metadataBase` still needs the answer and
// the precedence below is worth stating once.
//
// **The branch alias comes before the deployment URL, and getting that backwards
// took the console down.** `VERCEL_URL` is the per-deployment host
// (`travel-collab-<hash>-<team>.vercel.app`), which nobody browses; a preview is
// reached through the branch alias. When the admin page still forwarded a
// cookie, Deployment Protection had issued it for the alias, the fetch went to
// the deployment host, the request was challenged rather than served, and
// Vercel rate-limited the challenge — a `429` that surfaced as a 500 on every
// operator page load on every preview.
//
// The comment here once called that an acceptable edge case: "a host this
// deployment genuinely serves but which is in neither variable — a branch
// alias, say — now fails loudly". On a preview the branch alias is not an edge
// case, it is the only case. A trade-off written down is not a trade-off
// measured, and a named edge case that is really the default is worse than an
// unnamed one, because it reads as considered.
//
// The ordering still matters here for a quieter reason: `metadataBase` resolves
// the canonical and OG URLs, and pointing those at a per-deployment host makes
// every preview share a link nobody else can open.
//
// Every branch is pinned by `deploymentOrigin.test.ts`, which this function did
// not have when the precedence bug shipped.
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
