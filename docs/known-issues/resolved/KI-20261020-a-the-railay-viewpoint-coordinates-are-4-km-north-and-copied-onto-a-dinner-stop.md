### KI-2026-10-20-a — The Railay viewpoint's coordinates are about 4.2 km north, and the trip copies them onto a dinner stop

- **Severity:** correctness. A map pin and anything that measures distance from it (the river's
  travel gaps, the map lens, place search) put the stop on the mainland north of Ao Nang, not on
  the Railay peninsula.
- **Area:** `content/playbooks/thailand-beaches.json:118-119` (playbook
  `railay-limestone-and-sunset`, stop "Railay viewpoint, and the lagoon if it has not rained",
  `location.name` "Railay Viewpoint and Lagoon trail"); `content/trips/thailand-andaman.json:625-626`
  (the same stop, Day 4) and `:836-837` ("Night food stalls behind the walking street, East
  Railay").
- **Symptom / What happens:** all three carry `lat 8.048174, lng 98.832892`. The other Railay stops
  sit at lat 8.0056–8.0130, lng 98.8377–98.8446 (Phra Nang 8.005561/98.838732, Railay East jetty
  8.010676/98.839658). 8.048174 is Δlat 0.0377°, about 4.2 km north. The dinner stop's pair is a
  copy and paste: East Railay is about 8.011, 98.839. "Mama Chicken" (8.020221, 98.83615) is about
  1 km north of the walking street and is worth a look while there.
- **Why not fixed here:** found in the M51 design review (a prose-only part 0). The values came
  from `scripts/geocode-content.py`, whose cache and review file are not committed, so there is no
  authoritative value in the repo to restore.
- **Fix direction:** M51 part 1 (`claude/m51-part1-sea-snapshot`) fixes all three, with the
  viewpoint checked against OpenStreetMap or Nominatim (roughly 8.0097 N, 98.8378 E, on the walkway
  between Railay East and Phra Nang) and the dinner stop moved to East Railay. Production rows
  change only through `import-content-production.yml` (Mitchell's). No generated landing file
  carries these coordinates, so `landing:verify` is unaffected.
- **Cross-reference:** `docs/milestones/M51-the-front-door-tells-the-story.md`, decision 12;
  `docs/guidelines/content-bundles.md` (ADR-041).
- **First noted:** 2026-10-20, the M51 design review's part survey.
- **Resolved, 2026-10-20 (M51 part 1):** the viewpoint is 8.0097, 98.8378 in the playbook and
  the trip, and the dinner stalls 8.011, 98.839 in the trip: the values this entry gives.
  OpenStreetMap could not be reached from the build session (the proxy refused it), so these
  are the entry's approximations, not an OSM read; both sit on the walkway between Phra Nang
  and the East Railay jetty, not 4 km north. `scripts/landing-demo.test.ts` (*the Railay stops*)
  holds every stop either file places in `area: "Railay"` inside the peninsula's box; its north
  edge (8.025) admits Mama's Chicken at 8.020052, which this entry flagged and which was left
  alone for want of a source. Production's rows change only when Mitchell runs
  `import-content-production.yml`.
