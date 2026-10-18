### KI-2026-10-18-e — The seo "same 404" test goes red when the root layout's HTML grows, with no privacy change

- **Severity:** reliability. Nothing leaks. But the test that guards "a private day and an unknown
  one look the same" fails on an unrelated edit, and the next person to see it red will either
  chase a leak that is not there or loosen the test.
- **Area:** `apps/web/e2e/seo.spec.ts`, `comparable()` and the test "a private day and an unknown
  one are the same 404 with the same body"; `apps/web/src/app/layout.tsx` (the root layout, whose
  size moves it); `apps/web/src/lib/sessionHint.ts`, `LEAVE_LANDING_IF_SIGNED_IN` (the head script
  that was being grown).
- **Symptom:** adding about 84 bytes to the root layout's HTML (a dead comment in the inline head
  script was enough) made the `junk` case of that test fail 12 of 12 on
  `pnpm --filter web test:e2e:ci-like e2e/seo.spec.ts`, against 7 of 7 green on the base commit.
  The two 404 bodies differ only in where text falls relative to React's flight `<script>` chunks.
- **Cause:** `comparable()` strips the per-request parts (Sentry metas, the echoed path) and sorts
  the flight rows, joining across the `<script>` boundaries they are cut into. It does not
  normalise *where* those chunks are interleaved into the HTML. That position follows the
  streaming flush boundaries, and those follow byte counts, so a size change upstream moves which
  text lands in which sorted "line".
- **Why not fixed here:** PR 490 met it while adding a `pageshow` check to the head script, and
  avoided it by keeping the root layout's HTML exactly as long and moving the check into
  `LeaveLandingIfSignedIn`. Fixing the comparison is test work outside that PR.
- **Fix direction:** compare the two halves separately: extract the flight payload from every
  `self.__next_f.push` chunk, join and sort its rows; strip those `<script>` tags from the HTML
  and compare what is left as is. Prove it by adding a dead comment of 84 bytes or more to the
  root layout's head and watching the test stay green, then planting a real difference (the day's
  name in one body) and watching it go red.
- **Cross-reference:** ADR-078 (the landing is static and Home lives at `/home`).
- **First noted:** 2026-10-18, PR 490 (measured by its implementer; the mechanism confirmed in
  review, `seo.spec.ts` green 8 of 8 on its head with the layout unchanged).
