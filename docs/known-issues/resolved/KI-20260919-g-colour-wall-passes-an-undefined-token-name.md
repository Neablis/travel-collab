### KI-2026-09-19-g — the colour wall passes an undefined token NAME, so a control can ship invisible

- **Severity:** rework, and it has already cost once. A control that references
  a token nobody defined renders with no background and reads as a rendering
  bug, while every guard in the repo stays green.
- **Area:** `scripts/check-color-wall.mjs`, `apps/web/src/app/globals.css` (the
  `@theme` token definitions the wall would have to read).
- **Symptom / What happens:** the wall's job is stated in
  `docs/guidelines/design-system.md` — *"No raw color literals — CI grep:
  hex/rgb/hsl in `apps/web/src` outside `globals.css` fails the build"*. It
  therefore catches a **value** that should have been a token, and says nothing
  about a **name** that is not one. `bg-brand-tnit`, `text-warning-nk` or a
  `--color-` custom property `globals.css` never declares all pass clean; in
  Tailwind they simply produce no rule.

- **It has already fired.** `docs/STATUS.md` records it as one of two things M23
  left live: *"the colour wall scans for raw hex, so an **undefined token NAME**
  passes it clean — a selected chip shipped with a transparent background."*

- **Why it matters more now than it did:** the failure is invisible to every
  layer the repo has. The wall passes by construction; ESLint has no opinion on
  a class name; jsdom has no layout, and the lint wall refuses `toHaveClass`, so
  **no test layer can hold the claim that a box has a background** (also from
  M23's retro, and the same reason a code comment was wrong by 10.19px for two
  commits). The only detector is a person looking at a preview.

- **Cost of not fixing:** it scales with how much new token vocabulary a change
  introduces. M26 (design parity) introduces an underlined-tab treatment, a moss
  header strip on settings cards, and per-day accent inks on the Map rail — more
  new token usage than anything since M10.

- **Fix sketch (not done):** parse the token names `globals.css`'s `@theme`
  block defines, then fail on a `--color-*` custom property, or a
  `bg-`/`text-`/`border-` utility in the project's token namespace, that is not
  among them. The wall already walks the same file list (`git ls-files --cached
  --others --exclude-standard`), so this is a second predicate over an existing
  traversal, not a new script.

  Two things to get right, both learned by the existing wall: keep the
  `generatedNonProduct` exemption separate from any new pending list (KI-51
  records why the two lists must not merge — one only shrinks, the other never
  does), and prove the new predicate by **adding a bad token name and watching
  it go red** before trusting it (CLAUDE.md rule 3).

- **Fix:** M26 link 0, 2026-09-19, built exactly as the sketch above proposed —
  a second predicate over the wall's existing traversal, not a new script. It
  parses the names the `@theme` block defines (brace-matched, because a
  `html[data-look=…]` override restates a token rather than minting one, and a
  name that appeared only there would yield no utility) and fails on a
  `bg-`/`text-`/`border-`/`ring-`/`outline-`/`fill-`/`stroke-`/`divide-`
  utility, or a `--color-*` custom property, that is not among them.

  **It found two live defects on its first run**, neither of which any other
  layer could see:

  - `bg-canvas`, three times in `access/SharedTripScreen.tsx` — the page ground
    of the screen a non-member sees when they open a share link. It rendered as
    nothing. Fixed to `bg-paper`, which is what both of its sibling front-door
    screens (`LandingScreen`, `AuthScreen`) already use.
  - `ring-primary` in `pages/editor/MacroNodeView.tsx` — shadcn's default ring
    colour, which this app never defined, on the selected-widget ring. Fixed to
    `ring-brand`.

  Four decisions worth keeping, because each was a place the wall could have
  become the kind that gets ignored:

  - **`from-`/`via-`/`to-` are deliberately out.** They are gradient stops, and
    this repo's prose collides with them constantly — `to-now`, `to-the-line`,
    `to-json-schema` and `to-create` are all real strings in `apps/web/src`.
  - **Comments are stripped before the token scan.** This repo records its
    defects *in comments* — `ui/toggle-chip.tsx` names `bg-brand-subtle` and
    `text-muted` precisely because they were wrong, and `pages/cityAccents.ts`
    says there is no `--color-brand-ink`. A wall that read comments would force
    the deletion of the memory it was built on.
  - **A CSS property name is not a utility.** A real declaration is settled by
    the colon that follows it; a property name quoted or written into a regex
    is not, so `border-radius` and friends are named explicitly.
  - **The third exemption list stays separate** from `pending` (only shrinks)
    and `generatedNonProduct` (never does), per KI-51. It holds one entry — the
    AI SDK's `"text-delta"` chunk type — and a test fails if nothing in the tree
    spells it any more.

  Proven red before being trusted (CLAUDE.md rule 3): the two real defects
  above, plus an injection of all five shapes it claims to catch, plus
  `scripts/__tests__/check-color-wall.test.mjs`'s new cases, which were run
  against the *previous* wall and failed there.

- **Found by:** the M26 design-parity survey, 2026-09-19, reading `STATUS.md`'s
  M23 note against `scripts/check-color-wall.mjs`. Scoped as **M26 link 8b**,
  deliberately ahead of the links that would exercise the hole.
- **First noted:** 2026-09-19 (the defect itself: 2026-09-19, M23's gate).
  **Resolved:** 2026-09-19, M26 link 0.
