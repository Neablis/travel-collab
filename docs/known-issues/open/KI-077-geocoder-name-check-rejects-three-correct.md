### KI-77 — The geocoder's name check rejects three correct venues on tokenisation, and the overlay silently loses them
- **Severity:** cleanup (no product impact — `trip.ts` is canonical since ADR-030 and still carries 72/72 coordinates; this shrinks a cross-check, it does not move a pin)
- **Area:** `apps/web/src/server/ai/geocodeNameMatch.ts` (`nameTokens`, `distinctiveTokens`)
- **Symptom:** `placeNameVerdict` requires every distinctive token of the queried place to appear as a token of the candidate's own name, and `nameTokens` splits on every non-alphanumeric character. So a hyphen the vendor renders differently is a mismatch, and a translated suffix is a mismatch. Three of the Japan seed's stops are rejected this way — all three are the right place:
  ```
  "Gonpachi Nishiazabu"  vs  "Gonpachi Nishi-Azabu"   required [gonpachi, nishiazabu], candidate [gonpachi, nishi, azabu]
  "Tenryū-ji"            vs  "Tenryū Temple"          required [tenryu, ji],           candidate [tenryu, temple]
  "Ginkaku-ji"           vs  "Ginkakuji"              required [ginkaku, ji],          candidate [ginkakuji]
  ```
- **How it surfaced:** the 2026-08-29 regeneration for KI-58. These three had been in the overlay as `not-comparable` — the vendor had previously answered in local script (権八 西麻布, 天龍寺, 銀閣寺), which the check cannot read and therefore accepts. This run it answered in romaji, which the check *can* read and therefore rejects. **The verdict for a correct venue depends on which script the vendor happens to answer in**, which is not a property anyone chose.
- **Why it matters more than three rows:** `verify.ts` only checks a canonical coordinate where the overlay has an opinion, so each false rejection quietly removes one stop from the cross-check. It fails safe — nothing wrong is stored — but the guard covers 41 of 72 stops instead of 51, and nothing says so at the point of use.
- **Fix path:** compare on a concatenation-insensitive fold as well as a token fold, so "nishiazabu" matches "nishi"+"azabu" and "ginkakuji" matches "ginkaku"+"ji". That covers two of the three. "-ji" vs "Temple" is a translation, not a spelling, and wants either a small suffix synonym set (`-ji`/`-dera` → temple, `-jingū`/`-gū` → shrine) or acceptance that a translated name is `not-comparable` rather than `mismatch`. **Do not** simply widen `GENERIC_TOKENS` — that module's own comment warns a long list shrinks the distinctive set toward nothing.
- **Do not fix by loosening the caller.** The script's step 4b (KI-58) is a ranking; this is about what counts as a mismatch at all, and it belongs in the shared module with tests, not in the one-off script.
- **Found by:** the KI-58 fix, 2026-08-29.
- **Cross-reference:** KI-58 (the run that exposed it), KI-39 (which added the check), KI-15.
- **First noted:** 2026-08-29.
