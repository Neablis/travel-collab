### KI-2026-09-19-f — an accent reaches MapLibre through `getComputedStyle`, which is the documented non-fix

- **Severity:** latent. Correct today by accident; one token change makes every
  route line and every marker on the map render black, silently, with no test
  and no lint rule failing.
- **Area:** `apps/web/src/components/lenses/MapLens.tsx` (`accentVar`, and the
  three paint properties it feeds), `apps/web/src/app/globals.css` (the accent
  token definitions and the `:213-214` policy comment).
- **Symptom / What happens:** `accentVar` reads an accent token with
  `getComputedStyle(document.documentElement).getPropertyValue(...)` and passes
  the string straight into MapLibre's `"line-color"` (twice) and into
  `new Marker({ color })`.

  `.design-sync/handoff/DRIFT.md` §6 build-check 2 names this exact shape as the
  thing that *looks* like a fix and is not: *"canvas `fillStyle` and
  `getComputedStyle` both **preserve** `oklch()` verbatim, so they look like a
  fix and are not. Convert arithmetically wherever an accent reaches a map paint
  property."* MapLibre parses CSS Color 3 only and **falls back to black in
  silence** — no exception, no console warning, no failed layer.

  It works today **only because every accent token in `globals.css` happens to
  be hex** (`--color-brand: #0e7c66` and its neighbours, plus the four
  `data-look` overrides). The file says so itself at `:213-214`: *"**No `oklch`
  anywhere, deliberately.** DRIFT.md build-check 2…"* — **a policy stated in a
  CSS comment, with nothing enforcing it.**

- **Why it will fire:** SPEC §28 describes the Ledger look as bumping *"tint
  chroma and the solid"* for that look only, and `globals.css:247` acknowledges
  the bump. A chroma bump is the natural thing to express in `oklch`, which is
  what the rest of the design system's vocabulary uses. So the next person
  working on Ledger's city colour has every reason to write the one token that
  blacks out the map, and **nothing in the repo will tell them.**

  The colour wall does not catch it either — it greps for **raw hex literals**
  outside `globals.css`, and an `oklch()` value *inside* `globals.css` is
  exactly what it is built to permit.

- **Cross-reference:** `KI-49` (the Map lens's tiles have never been visually
  confirmed to paint in any environment) means a black line on a blank canvas is
  currently **unobservable** — the two entries compound, and a walk cannot
  distinguish them.

- **Fix sketch (not done):** either an arithmetic `oklch → sRGB` conversion
  behind `accentVar`, or a test that asserts every accent token resolves to a
  CSS Color 3 value. Prefer the test **and** the conversion: the test fails
  loudly at the moment the token changes, and the conversion means the failure
  is a red suite rather than a black map. **Do not reach for canvas `fillStyle`
  or another `getComputedStyle` round trip** — build-check 2 exists because both
  were tried.

- **Found by:** the M26 design-parity survey, 2026-09-19, reading
  `MapLens.tsx:39-41` against DRIFT §6 build-check 2. Scoped as **M26 link 8a**.
- **First noted:** 2026-09-19.
