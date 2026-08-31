### KI-20260830 — The colour wall reads a PR reference from #100 upward as a raw hex colour
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
