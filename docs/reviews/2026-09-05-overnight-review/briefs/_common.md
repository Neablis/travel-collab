# Common brief — read before your stream's brief

You are one of seven parallel read-only review agents on the travel-collab repo
(`/home/user/travel-collab`, branch `claude/project-overnight-review-nxjj1y`).
You are researching, not fixing. **Do not edit any file outside
`docs/reviews/2026-09-05-overnight-review/`, and do not commit.**

Orientation, in this order, skimming rather than reading whole:
1. `AGENTS.md` — the invariants (§The Invariants), module map, dependency rules.
2. `docs/STATUS.md` first 120 lines — where the work is.
3. `docs/reviews/2026-08-28-project-review.md` — the last full review. Do not
   re-report anything it reported unless it is still present AND unfixed AND
   not in `docs/known-issues/`; if so, say "still open since 2026-08-28".
4. `ls docs/known-issues/open/` — before you report a symptom,
   `grep -rli "<symptom words>" docs/known-issues/` and link the KI instead of
   duplicating it.

Rules for every claim:
- **Cite `path:line`** for every factual statement about code. Open the file
  and read the lines; do not infer from names.
- **Label confidence:** CONFIRMED = you traced the full path (caller → callee →
  effect) and could write the reproduction. PLAUSIBLE = you saw the mechanism
  but did not prove the trigger. Anything less is not a finding; put it in a
  final "leads not run down" list.
- **Severity:** HIGH (data loss, authz bypass, spend, or blocks the next
  milestone), MEDIUM (wrong behaviour users hit, or a pattern that will cost
  every future change), LOW (cleanup, cosmetic, small).
- **Say what is healthy.** A "verified sound" list is as useful as the
  findings; it stops the next reviewer re-deriving it.
- Prefer few, well-traced findings over many shallow ones. Ten CONFIRMED beats
  forty guesses.
- Do not run `pnpm check`, `pnpm test`, e2e, or any long lane unless your brief
  says you own it (only stream G does). Typecheck of one package is fine.
- Use Bash (`sed -n`, `grep -rn`, `wc -l`) to read; keep reads scoped to what
  you need.

Report shape (your final message; it is the only thing the coordinator sees):

```
## Stream <X> — <name>
### Findings (severity desc)
#### <X>01 — <one line> — <SEVERITY> / <CONFIDENCE>
- Area: file:line, file:line
- What is wrong: …
- Verified by: …
- Suggested fix: …
- Fix scope: files; contracts changed? migration? check subset
- Test that should exist: …
- Cross-ref: KI-…, ADR-…
- Do not: …
(repeat)
### Verified sound
- …
### Patterns (what works / what recurs) — if your brief asks for it
### Leads not run down
- …
```
