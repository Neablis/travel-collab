### KI-2026-09-25-n — `scripts/geocode-content.py` never geocodes a content bundle stop's `endLocation`

- **Severity:** latent. No bundle under `content/` carries an `endLocation` today, so nothing is wrong yet. The first bundle to add a leg will import without destination coordinates.
- **Milestone:** M24, carried rather than gating. Found by the whole-stack review of #229–#233 on 2026-09-25.
- **Area:** `scripts/geocode-content.py` `places()` (reads `stop["location"]` only). `packages/fixtures/src/bundle/toCommands.ts` imports bundle stops without server-side enrichment, so the geocoder script is the only thing that ever puts coordinates on a bundle.
- **What happens:** M24 added `endLocation` to `BundleStop`. The script collects and writes back `location` alone, so a bundle leg's destination keeps whatever an author typed, and usually has no `lat`/`lng`. The map then draws no leg for it, and the conflict rule treats it as having no destination.
- **Fix shape:** make `places()` and the write-back walk both `location` and `endLocation`, and add the bundle rule to `content:verify` if a destination without coordinates should be refused. See `docs/guidelines/content-bundles.md` (ADR-041).
- **Paired with:** KI-2026-09-25-o. The reconciler has the same one-field assumption.
- **First noted:** 2026-09-25.
