### KI-2026-09-24-o — the app now sends rounded stop locations to weather providers, and no page tells the reader so

- **Severity:** minor (disclosure). ADR-052's Consequences ask for a line saying that the Weather widget sends a rounded location (2 decimals, about 1 km) to MET Norway and NASA POWER. The app has no privacy page to put it on.
- **Milestone:** M14, carried rather than gating. Filed on PR #221 with T24.
- **Area:** `apps/web/src/server/external/` (what leaves the building: `roundForExport`, the User-Agent carrying `EXTERNAL_DATA_CONTACT`), and the missing privacy/data page.
- **Symptom / What happens:** a reader who inserts "Weather" has a rounded stop location sent to two third parties, and nothing in the product says so. The block's footer credits the sources but does not describe what is sent.
- **Why not fixed here:** a privacy page is a product and legal surface, not a widget change. Mitchell accepted the data flow on 2026-09-24; the wording of the disclosure is his.
- **First noted:** 2026-09-24, M14 T24.
