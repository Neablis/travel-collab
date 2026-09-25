### KI-2026-09-25-o — the bundle location reconciler compares and patches `location` only, so a corrected `endLocation` never reaches an imported trip

- **Severity:** latent. No bundle carries an `endLocation` yet (see KI-2026-09-25-n). Once one does, a destination fixed in the bundle file will stay wrong on every trip already imported.
- **Milestone:** M24, carried rather than gating. Found by the whole-stack review of #229–#233 on 2026-09-25.
- **Area:** `apps/web/src/server/bundleLocationReconcile.ts`. The plan loop builds `{ ...current, location: to }` and emits `UpdateActivity { location }` only.
- **What happens:** the reconciler exists to carry a geocode audit's corrections from a bundle into trips that were imported before the fix (the KI-2026-09-23-e case). It compares only `location`, so a corrected `endLocation` looks like "no difference" and no update is planned.
- **Fix shape:** compare `{ ...current, location, endLocation }` through the same `activityStatesEqual`, and patch whichever changed. A destination has only a coordinate to correct, since its legality depends on `kind`, which the reconciler does not touch.
- **First noted:** 2026-09-25.
