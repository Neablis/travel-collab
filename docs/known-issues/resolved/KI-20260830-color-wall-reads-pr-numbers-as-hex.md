### KI-20260830 — The colour wall reads a PR reference from #100 upward as a raw hex colour — RESOLVED
- **Severity:** cleanup (no user impact; blocks `pnpm check` on a correct change, and will do so with increasing frequency)
- **Area:** `scripts/check-color-wall.mjs:47`

- **Symptom (2026-08-30, building M11b PR1's review fixes):** `pnpm check`
  fails at the colour wall on two files whose only offence is a code comment
  citing the pull request the change came from:
  ```
  apps/web/src/server/savedDayAdds.int.test.ts:126: raw color literal (tokens only — design-system.md)
  apps/web/src/server/savedDays.ts:96: raw color literal (tokens only — design-system.md)
  ```
  Both lines read `… review on PR #100 …`. There is no colour anywhere near them.

- **Cause, and why it starts now.** The matcher is
  `const colorLiteral = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/;`
  `#100` is three hex digits followed by a word boundary, so it matches. Every
  decimal PR number from **#100 to #99999999** is also a valid 3-to-8 digit hex
  string, so **every such reference in a comment trips the wall**. `#99` and
  below are two digits and fall under the `{3,8}` floor — which is precisely
  why this had never fired before and fires now: **this repo reached PR #100
  on 2026-08-30.** It will keep firing for every PR from here on.

- **Discriminator:** the wall names a file and line with no colour on it. Read
  the line; if the "hex" is a `#` followed by decimal digits in prose, this is
  the entry. A real violation has a colour value in code, not in a comment.

- **Workaround in use:** write the reference without the `#` — "pull request
  100", or "PR 100". Applied on `claude/m11b-contracts`.

- **Fix path, NOT taken unilaterally — this is an enforcement wall and
  `AGENTS.md` says a wall that blocks you is a finding to report, not a rule to
  bend.** Mitchell's call. Three options, cheapest first:
  1. **Ignore a `#` immediately preceded by `PR ` / `pull request `.** Narrowest
     change, keeps every real hex caught, but only covers the phrasings listed.
  2. **Require the hex to be inside quotes, a `style=` value, or a CSS-ish
     context.** Matches what the wall is actually for — a colour that reaches
     the UI — at the cost of a more complex matcher.
  3. **Skip comment lines.** Simplest to write and the most weakening: a raw
     hex sitting in a comment is often a design value about to be pasted into
     code, and the wall catching it there has value.
  Option 1 or 2. Whichever is chosen, the change needs a test asserting a real
  raw hex is still caught — the wall's own anti-vacuity guard.

- **Not the same as:** the pending re-skin list, which is a deliberate
  allowlist of pre-M5 surfaces and shrinks as they are re-skinned.

- **Resolved 2026-09-02 — option 2, narrowed so it cannot weaken anything.**
  Reproduced first: a one-line file `// Fixed in review on PR #100 — see the
  thread.` at `apps/web/src/server/` made the wall print
  `apps/web/src/server/ki20260830-repro.ts:1: raw color literal (tokens only —
  design-system.md)` and exit 1, with no colour on the line.

  The fix splits `scripts/check-color-wall.mjs:47`'s single
  `#[0-9a-fA-F]{3,8}\b` into two cases. A hex containing **any** `a-f` letter
  (`#0c6b58`, `#FFF`, `#553DB8`) is unambiguous and is still flagged wherever it
  sits — nothing about that case changed. Only the **all-decimal** hex is
  ambiguous, because that is precisely the shape a GitHub reference takes; that
  case is now flagged only in a colour context — quoted, bracketed, or after
  `:` / `=` / `,` (`color: #111`, `"#111"`, `bg-[#111]`, `var(--x, #111)`).
  Prose has none of those in front of it. `rgb()/rgba()/hsl()/hsla()` and the
  arbitrary-Tailwind-value matcher are untouched. Accepted residual, documented
  at the matcher: an all-decimal hex written bare in a prose-like position
  (`// grey is #222`) is no longer flagged. `globals.css` is the tree's only
  `.css` file and is exempt, so a bare CSS declaration is not a real context
  here; every raw colour in a `.tsx` arrives quoted or inside a `<style jsx>`
  block, where the `:` keeps it caught.

  **Proof.** Same reproduction, after the fix: `color wall OK (464 files
  scanned…)`, exit 0. Anti-vacuity, run against a deliberately bad seven-line
  file: all seven lines flagged, including both all-decimal hexes (`"#111"`,
  `bg-[#100]`), exit 1. Two regression tests added to the existing
  `scripts/__tests__/check-color-wall.test.mjs` — one asserting a `PR #100` /
  `pull request #4271` / `issue #12345678` comment passes, one asserting all
  seven raw colours still fail, which is the pair's anti-vacuity guard. Both
  were run against the pre-fix matcher to confirm they bite: the PR-reference
  test failed there with the original symptom, the raw-colour test passed.
  Per `minimal-check-subset` (both changed files are root-level `scripts/**`,
  so they map to no workspace package and nothing under
  `packages/contracts/src` changed): `node --test
  "scripts/**/__tests__/**/*.test.mjs"` 138/138, and `node
  scripts/check-color-wall.mjs` — the wall's own lane inside `pnpm lint` —
  clean on the real tree. Full `pnpm check` deliberately not run: several units
  were running concurrently, which is the load condition KI-13 documents.

  The `#`-less workaround ("PR 100") is no longer needed, but existing comments
  that use it were left alone — rewriting them would touch files outside this
  entry's area for no behavioural gain.
