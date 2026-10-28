### KI-2026-09-27-a — a production deploy of `main` failed because Google Fonts did not answer the build — RESOLVED

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
- **Reproduced (2026-10-28):** with every proxied host unreachable (`HTTPS_PROXY` pointed at a
  closed port) and no `.next/cache`, `main`'s build failed: `There was an issue establishing a
  connection while requesting https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600&display=swap`,
  then `Turbopack build failed with 3 errors` (`next/font: error`, one per family). With a warm
  `.next/cache` the same offline build passed, which is why a failure only shows on a cold
  builder like Vercel's.
- **Fixed:** the intended fix. `apps/web/src/app/typefaces.ts` loads the three families through
  `next/font/local` from woff2 files committed in `apps/web/src/app/fonts/` (Fontsource 5.3.0,
  SIL OFL 1.1, licenses beside them): variable `wght` files for Bricolage Grotesque and IBM Plex
  Sans, static 400/500 for IBM Plex Mono, the same shape Google served. Every unicode-range
  subset Google served is kept (latin, latin-ext, vietnamese, and cyrillic/greek where the family
  has them), one call per subset since `next/font/local` puts its `declarations` on every face;
  only latin preloads, as before. `globals.css` composes the per-subset variables back into
  `--font-next-display`, `--font-next-sans` and `--font-next-mono`, so no consumer changed, and
  Ledger's `html[data-look]` override of `--font-next-display` still wins.
- **Proof:** the same cold, offline build passes with the fix. Built CSS before and after: four
  preloaded latin files both times; the same unicode ranges; the fallback faces are still
  metric-adjusted `local(Arial)`, though `next/font/local` derives slightly different overrides
  from the file than Google's table (Bricolage `size-adjust` 112.88% vs 105.43%, Plex Mono
  131.49% vs 134.59%, Plex Sans 101.13% vs 101.17%), which shows only during the swap. In
  Chromium against the built app (`next start`), `--font-next-sans` resolved to the subset
  families with the latin one and its fallback last, and a "Łódź" probe and a "Đà Nẵng" probe
  loaded `sansLatinExt` and `monoVietnamese` only, no cyrillic or greek file.
  `src/app/typefaces.test.ts` (each test seen red: a subset dropped from globals.css, a font path
  renamed, `main`'s `next/font/google` layout restored) holds the composition, the files and the
  absence of `next/font/google`.
- **Not done:** whether a failed production deploy of `main` should alert anyone is still
  undecided. `apps/web/scripts/generate-og-assets.mjs` still fetches Google Fonts, but by hand,
  not in the build.
