### KI-2026-10-20-c — The landing's sea keeps linking a day that production has unpublished or removed

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
  drift, and part 2 builds the sea, not its link audit.
- **Fix direction:** a scheduled check (or a step in `import-content-production.yml`) that
  requests every href in `landingSea.generated.json` against production and fails on a non-200,
  or a build-time read of production's published ids. Alternatively, put one line in M51 part 7's
  scope so the production half of the links ruling has an owner.
- **Cross-reference:** M51's milestone file, decision 10 (on the part 0 branch
  `claude/m51-front-door-plan` until it merges);
  ADR-041 (`docs/guidelines/content-bundles.md`); ADR-063 (the day page's cache).
- **First noted:** 2026-10-20, PR 510's fresh review, finding 11.
