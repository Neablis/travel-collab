### KI-2026-09-25-n — the content bundle pipeline reads a stop's `location` only, so a leg's `endLocation` is never geocoded and a corrected one never reaches an imported trip

- **Severity:** latent. No bundle under `content/` carries an `endLocation` today, so nothing is
  wrong yet. The first bundle with a leg will import with no destination coordinates, and fixing
  the destination in the bundle afterwards won't fix trips that already imported it.
- **Milestone:** M24, carried rather than gating. Found by the whole-stack review of #229–#233 on
  2026-09-25.
- **Area:** both places that assume one location field per stop:
  - `scripts/geocode-content.py` `places()`, which reads `stop["location"]` only, and its
    write-back. `packages/fixtures/src/bundle/toCommands.ts` imports bundle stops without
    server-side enrichment, so this script is the only thing that ever puts coordinates on a
    bundle.
  - `apps/web/src/server/bundleLocationReconcile.ts`. Its plan loop builds
    `{ ...current, location: to }` and emits `UpdateActivity { location }` only.
- **What happens:**
  - Geocoding: M24 added `endLocation` to `BundleStop`. The script collects and writes back
    `location` alone, so a leg's destination keeps whatever the author typed, usually with no
    `lat`/`lng`. The map then draws no leg for it, and the conflict rule treats it as having no
    destination.
  - Reconciling: the reconciler carries a geocode audit's corrections from a bundle into trips
    imported before the fix (the KI-2026-09-23-e case). It compares `location` only, so a
    corrected `endLocation` looks like "no difference" and no update is planned.
- **Fix shape:**
  - Make `places()` and the write-back walk both `location` and `endLocation`. If a destination
    without coordinates should be refused, add that rule to `content:verify`.
  - Make the reconciler compare `{ ...current, location, endLocation }` through the same
    `activityStatesEqual`, and patch whichever changed. A destination only has a coordinate to
    correct: whether it is allowed depends on `kind`, which the reconciler doesn't touch.
  - See `docs/guidelines/content-bundles.md` (ADR-041).
- **Cross-reference:** KI-2026-09-25-o (merged here on 2026-10-17, moved to `resolved/` as a
  duplicate); KI-2026-09-25-q.
- **First noted:** 2026-09-25.
