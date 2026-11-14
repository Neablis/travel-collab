### KI-2026-10-20-c — The landing's sea keeps linking a day that production has unpublished or removed — RESOLVED

- **Severity:** correctness. A front-door door opens a 404 in production.
- **Area:** `apps/web/src/lib/landingSea.generated.json` (the sea's snapshot, built from
  `content/` by `apps/web/scripts/landing-demo.ts`), drawn by
  `apps/web/src/components/front/LandingSea.tsx`; the day page `/playbooks/day/[segment]`.
- **Symptom / What happens:** the sea is a build-time copy of the library as `content/` holds it.
  If a library day is unpublished or deleted in production's database without a matching change
  to `content/` (by its owner, by moderation, or by an admin), the landing keeps drawing that day
  and links it to a page that now 404s. M51's decision 10 requires production's sea links to
  resolve.
- **Why not fixed here:** found in PR 510's fresh review (M51 part 2). Part 7's checks cover the
  importer's ids and the preview, not production's state after the import, so no part owns the
  drift, and part 2 builds the sea, not its link audit. At M51's gate close (2026-10-22) Mitchell
  kept it open, to be built later; M51 closed with the production half of decision 10 unchecked.
- **Fix direction:** a scheduled check (or a step in `import-content-production.yml`) that
  requests every href in `landingSea.generated.json` against production and fails on a non-200,
  or a build-time read of production's published ids. Alternatively, put one line in M51 part 7's
  scope so the production half of the links ruling has an owner.
- **Resolution (2026-11-14):** the fix direction's scheduled check. `scripts/check-landing-sea-links.mjs`
  requests every href in `landingSea.generated.json` against `SITE_URL` (required, never defaulted)
  and fails, naming each href, on anything that does not end on a 2xx: a 4xx/5xx, a same-host
  redirect chain that ends on one, a redirect off the host, a loop, or no response twice. A
  same-host redirect that ends on a 2xx passes (a renamed day's old slug still opens the day).
  `.github/workflows/landing-sea-links-production.yml` runs it daily (`41 7 * * *`) and on
  `workflow_dispatch` with `SITE_URL: https://caesura.today`; no `pull_request` trigger, no secret,
  sparse checkout and no install. Reproduced as a gap first: the only sea-link check,
  `preview-link-check.yml`, runs on `pull_request` against the PR's preview and never against
  production. Proven against a local stub serving one 200 and one 404 href (production was not
  requested from the session): `::error::/playbooks/day/unpublished: HTTP 404`, `1 of 2 sea links
  opened a page`, exit 1; `scripts/__tests__/check-landing-sea-links.test.mjs` (8 tests) seen red
  with a 4xx counted as a pass and with any 3xx counted as a pass. The first scheduled run on `main`
  is the first real reading of production; until it is green, decision 10's production half is
  watched, not yet shown to hold.
- **Cross-reference:** M51's milestone file
  (`docs/milestones/M51-the-front-door-tells-the-story.md`), decision 10 and its retro;
  ADR-041 (`docs/guidelines/content-bundles.md`); ADR-063 (the day page's cache).
- **First noted:** 2026-10-20, PR 510's fresh review, finding 11.
