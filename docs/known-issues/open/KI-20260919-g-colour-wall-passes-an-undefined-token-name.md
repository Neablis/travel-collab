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

- **Found by:** the M26 design-parity survey, 2026-09-19, reading `STATUS.md`'s
  M23 note against `scripts/check-color-wall.mjs`. Scoped as **M26 link 8b**,
  deliberately ahead of the links that would exercise the hole.
- **First noted:** 2026-09-19 (the defect itself: 2026-09-19, M23's gate).
