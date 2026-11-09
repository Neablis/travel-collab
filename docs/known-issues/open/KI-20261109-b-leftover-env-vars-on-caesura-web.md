### KI-2026-11-09-b — three unread env vars left on the Coolify application

- **Severity:** cleanup.
- **Area:** Coolify `caesura-web` env (`LOCATION_API_KEY`, `UNSPLASHED_ACCESS_KEY`, `NEXT_PUBLIC_VERCEL_ENV`).
- **Symptom / What happens:** the application carries three variables nothing reads. The first two are the old misspelled names copied from Vercel; the app reads `LOCATIONIQ_API_KEY` and `UNSPLASH_ACCESS_KEY`, which are also set. `NEXT_PUBLIC_VERCEL_ENV` has no reader in `apps/web/src` (checked at `5504d935`).
- **Why not fixed here:** they are Mitchell's originals, left in place at the cutover rather than deleted without asking.
- **Fix path:** delete the three in Coolify → `caesura-web` → Environment Variables (production and preview copies), then redeploy and check `/api/health`.
- **Tripwire:** someone sets a value on the old name and wonders why geocoding or covers did not change.
- **Cross-reference:** M59, `docs/ops/coolify-vps.md`.
- **First noted:** 2026-11-09, M59 cutover.
