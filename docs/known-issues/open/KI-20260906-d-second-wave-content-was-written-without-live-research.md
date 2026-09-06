### KI-2026-09-06-d — prices in eight content bundles are still unverified model estimates, though their gating facts are now checked

- **Severity:** content accuracy, and **materially narrower than when this was filed.** The half that made days *unusable* is fixed; what remains is that a ticket price may be stale. Every one of these days is `authorKind: "ai"` in the database and carries the "AI starter" badge, so no reader is told a person checked it.
- **Area:** `content/playbooks/` — `australia-newzealand`, `britain-ireland`, `california-coast-and-wine`, `finger-lakes-upstate-ny`, `france-cities`, `italy-cities`, `korea-taiwan-hongkong`, `turkey-balkans`. Each file's `bundle.sources` opens with a `PARTIALLY VERIFIED 2026-09-06` line naming exactly what was and was not checked.

#### What was fixed (2026-09-06)

A **gating-facts pass** ran over all 60 days: opening days of the week, opening and closing times, seasonal operation, construction and fire closures, permit and booking rules, and transport that only runs on some days. Roughly 150 live searches against official sources. It was worth far more than the estimate that justified it — **at least fourteen days were impossible as written**, and the failure mode was uniformly *staleness*, never invention:

- **Two venues no longer exist.** Edinburgh's Gardener's Cottage closed for good in December 2024; the National Slate Museum has been shut since November 2024 with reopening slipped to 2027.
- **Three headline stops are no longer deliverable.** Etna's summit craters are inside a post-eruption access cap; the Beitou hot-spring pool has been closed for renovation since January 2025; Big Sur's state parks are still closed even though Highway 1 reopened on 3 September 2026.
- **A whole day was on the wrong reef** — Wavelength's moorings are Opal/Tongue/St Crispin, not Agincourt.
- **Sailings and departures that do not exist** were booked: Milford's 10:45, the Nevis 08:15 bus, a Sénanque tour at 11:15, an October schooner that stops sailing at Columbus Day.
- **Six days started before their venue opened** (Torcello, Matera, Dr. Frank, Wiemer, Mission Dolores, Monte Solaro), and several others ran past closing.
- **Day-of-week constraints nobody had noticed**: Rome is Mon–Sat, Naples is Wed–Sun, the Hudson Valley day is Fri–Mon, Forge Cellars is closed Mon–Thu.

Two corrections ran the *other* way and are the reason a pass like this is not just defensive: the Louvre does **not** allow re-entry (the file told readers to leave for lunch and come back), and Halles de Lyon is **not** closed Mondays as the file claimed.

#### What is still open

**Prices were deliberately not hunted.** A price was corrected only when an authoritative page happened to state one while a gating fact was being checked — about twenty of them were, including two that were the wrong *ticket* rather than the wrong number (Plitvice priced at its after-15:00 band for an 08:30 entry; Dubrovnik's walls at a rate that excludes Lovrijenac). The rest of the ~418 priced stops in these bundles remain model estimates.

Each file also lists, in its own `bundle.sources`, the specific stops left unchecked — restaurant closing days, local transport fares, operator rates. Those lists are the worklist for a future pass, and they are deliberately per-file rather than gathered here, where they would go stale.

- **`pnpm content:verify` will never catch any of this.** It checks structure and content rules, not whether a price is true. That is why this entry exists.
- **The right next pass**, if one is wanted, is prices only, and it is worth much less than the one already done: a wrong price in AI-flagged seed content costs a reader nothing at the point of use, where a closed venue costs them a day.
- **Cross-reference:** ADR-041 (the format and why the content exists), **KI-2026-09-06-c** (the same content's missing coordinates — same principle, an unverifiable fact is better omitted than asserted).
- **First noted:** 2026-09-06. **Narrowed the same day**, once the gating-facts pass landed.
