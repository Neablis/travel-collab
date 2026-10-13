### KI-2026-10-12-c — the eval's country-name check passes some wrong answers and fails some right ones

- **Severity:** correctness, of the eval's verdict only. No product behaviour is wrong; an eval
  case can be graded the wrong way in either direction.
- **Area:** `apps/web/src/server/ai/eval/grade.ts:96-99` (`namesWholeWord`, used by the
  `namesOneOf` check at `:215-221`), and the `a-next-country` case in
  `apps/web/src/server/ai/eval/cases.ts:214`, which feeds it country names from
  `packages/domain/src/trip/countryList.ts`. **This code is on PR 421's branch
  `claude/m45-part3-account-ask` until it merges**; it is not on `main` yet.
- **Symptom:** the check is a whole-word regex, `(?<!\p{L})name(?!\p{L})` with flags `iu`. Every
  listed name matches itself, and none throws. But:
  - **Wrong answers pass.** Through the `i` flag: "fine china" passes for China, "pack a jersey"
    for Jersey, "guinea fowl" for Guinea. As whole words in any case: "New Jersey",
    "Bermuda shorts", "Georgia".
  - **Right answers fail.** "Turkey" (the list has "Türkiye"), "Korea" without "South",
    "Czech Republic" (the list has "Czechia"), "Macau" ("Macao"), "Cape Verde", "Ivory Coast",
    "Scotland", "the UK" and "the USA". Also "Côte d’Ivoire" with a typographic apostrophe, which
    models often write, decomposed (NFD) text such as "Curaçao", and a non-breaking space or line
    break inside a two-word name.
- **Why not fixed here:** found in PR 421's third review (finding n1-r3) as a non-blocking nit.
  The false fails are not new (the earlier substring rule missed them too) and they fail loudly;
  the false passes are rarer than the documented comparison gap in `cases.ts:200-203`.
- **Fix direction:** drop `i` for proper names (country names are proper nouns, which removes the
  china/jersey/guinea passes for free); add a small alias map (`TR: ["Turkey"]`,
  `KR: ["Korea"]`, `CZ: ["Czech Republic"]`, `GB: ["UK", "United Kingdom"]`, …); normalise the
  text before matching (`text.normalize("NFC")`, typographic apostrophe to `'`, any whitespace
  run to one space). Prove each with a red-first case in the grade tests.
- **Cross-reference:** M45 part 3 (PR 421); the review is at round 3 on `29de655`.
- **First noted:** 2026-10-12, M45 (PR 421 review round 3, n1-r3).
