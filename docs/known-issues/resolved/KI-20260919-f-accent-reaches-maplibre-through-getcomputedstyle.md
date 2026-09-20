### KI-2026-09-19-f — an accent reaches MapLibre through `getComputedStyle`, which is the documented non-fix

- **Severity:** latent (as found). Correct today by accident; one token change makes every
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

- **Fix:** both halves of the sketch, because the sketch was right that one
  without the other leaves the hole open.

  **The conversion** is `apps/web/src/components/lenses/mapColor.ts`:
  `oklchToHex` does the arithmetic (OKLab matrices → linear sRGB → the CSS
  transfer function), and `mapPaintColor` applies it to a computed value,
  passing through anything MapLibre already parses and returning a fallback —
  never the original string — for an `oklch()` it cannot read. `accentVar` in
  `MapLens.tsx` now goes through it, and so does the route line of the new
  `SharedDayMap`. No canvas `fillStyle`, no second `getComputedStyle` round
  trip; build-check 2's two documented non-fixes are not used.

  **The test** is `mapTokens.test.ts`, which reads `globals.css` itself and
  asserts every `--color-*` token still lands on CSS Color 3 after conversion.
  It resolves `var()` aliases first — three tokens are aliases, and the browser
  resolves the chain before `getComputedStyle` returns it, so asserting against
  the literal `var(--color-brand)` would both fail on healthy tokens and pass
  on an alias pointing at a bad one. It also asserts it found more than twenty
  tokens, so a change to the stylesheet's shape cannot turn the sweep into a
  vacuous loop over nothing.

  `mapColor.test.ts` anchors the conversion on the three published sRGB
  primaries rather than on this code's own output, which would have made it a
  tautology.

  **Verified by breaking it** (CLAUDE.md rule 3), in both directions that
  matter: `--color-brand: lab(45% -30 5)` turns the suite red, while
  `--color-brand: oklch(0.4986 0.0903 173.4)` — the exact spelling the entry
  predicted for SPEC §28's Ledger chroma bump — now passes, because the
  conversion handles it. That pair is the entry's claim, demonstrated.

  **What is still true:** the policy comment at `globals.css:213-214` is no
  longer load-bearing, but `mapPaintColor` converts `oklch()` only. `lab()`,
  `lch()` and `color(display-p3 …)` are still unparseable by MapLibre and are
  deliberately NOT converted — the test is what catches those, which is why the
  sketch asked for both.

  **`KI-49` is NOT resolved by this** and the cross-reference below still
  stands: a correct colour on a canvas whose tiles have never been visually
  confirmed is still unobserved. `SharedDayMap` gives that a second, simpler
  surface to be confirmed on.

- **Found by:** the M26 design-parity survey, 2026-09-19, reading
  `MapLens.tsx:39-41` against DRIFT §6 build-check 2. Scoped as **M26 link 8a**.
- **First noted:** 2026-09-19. **Resolved:** 2026-09-20 (M26, alongside the
  shared-day map that would otherwise have become a second consumer of the bug).
