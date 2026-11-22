# Part 5 review — og:image origin e2e fix (7eacb17..21d4f01c)

Verdict: approve. Read-only; spec not run by the reviewer (implementer: 21/21 under ci-like, mutation seen red).

1. Only apps/web/e2e/seo.spec.ts changed (+9 −4, drops the BASE_URL import).
2. Not vacuous: relative og:image fails the ^https?:// check (:553); foreign origin fails the canonical-origin comparison (:554); non-200 / non-image fails (:558-559).
3. Minor blind spot: canonical and og:image share metadataBase (deploymentOrigin(), layout.tsx:29), so a wrong origin both share passes. The old check compared against the harness BASE_URL, so it did not catch that either.
4. No dependence on the build-time port. 5. Image fetched by path through the server under test.
6. No mutation leftover (evil.example hits under apps/web/src are existing security fixtures).
