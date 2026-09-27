### KI-2026-09-27-a — a production deploy of `main` failed because Google Fonts did not answer the build

- **Severity:** reliability. A merge to `main` does not reach production, and nothing
  tells anyone: the aliases stay on the last good build, so production silently runs
  one merge behind. Fix soon: every deploy depends on it.
- **Area:** `apps/web/src/app/layout.tsx:4` loads Bricolage Grotesque, IBM Plex Sans and
  IBM Plex Mono through `next/font/google`, which downloads the font files from
  `fonts.googleapis.com` / `fonts.gstatic.com` **at build time** (the proxy log in
  `resolved/KI-20260924-v-…` shows those are the build's only outbound hosts).
- **Symptom / What happens:**
  - Merging #251 made `main` `af9a224`. Its production deployment
    `dpl_BrgcvURQ9niGbUEBXw3Qu542NnCF` ended in **ERROR** at `buildStep`:
    `Error while looking up import map: next/font/google queries have exactly one entry`,
    `[next]/internal/font/google/bricolage_grotesque_3834bf73.module.css:8:8` (and every
    `@font-face` after it), `module-not-found`, then
    `Command "pnpm run vercel-build" exited with 1`.
  - The previous production deployment, `dpl_3sVxcnGv5BAne4cYfqRt5DJ2qxoC` (`33305d5`),
    is READY, so production is serving `33305d5`.
- **Not the cause, checked (2026-09-27):** `git diff 33305d5 af9a224` touches no font,
  layout, `next.config` or lockfile. It is board and e2e code only. #251's own preview
  (`dpl_BTYdcmoBNixQe8Y6WvQLatodiXHH`, `49e9d80`) built READY. So this is a failed font
  fetch, not the change. It is not reproduced yet: a redeploy is the test, and it is
  Mitchell's to run.
- **Why not fixed here:** redeploying production is an outward-facing action, and it
  was not requested. The durable fix changes the font pipeline, which the design system
  owns (`docs/guidelines/design-system.md`).
- **Immediate step:** redeploy `af9a224` (Vercel → Deployments → Redeploy, or push the
  next merge). If it fails the same way twice, it is not transient.
- **Intended fix:** vendor the three families' `woff2` files and load them through
  `next/font/local`, so the build fetches nothing. The CSS variables
  (`--font-next-display` etc.) stay the same, so no consumer changes. Also worth
  deciding: whether a failed production deploy of `main` should alert anyone. Today it
  only surfaces if a session happens to list deployments.
