# STATUS archive — 2026-10-02

Moved here verbatim from `docs/STATUS.md` at M19's gate close. The section was M14's
closed-milestone record, and M19 replaced it as the most recent close. M14's retro is at
the end of `docs/milestones/M14-rich-layer.md`.

## CLOSED 2026-10-01 — M14 Rich layer, pulled ahead of M24; gate 22 of 22

Mitchell's call, 2026-09-24: build all of M14 ahead of M24. It shipped as four
stacked PRs: #222 → #223 → #226 → #221. **The gate closed 2026-10-01.** On
2026-09-27 Mitchell settled the insert Sheet box (a fixed sample preview, as
ADR-037 says) and accepted the six widgets on their e2e and ADR-052 as built. On
2026-10-01 he attested the real-service weather walk. The retro is at the end of
`docs/milestones/M14-rich-layer.md`. `docs/retros/2026-09-24-m14-stacked-prs-retro.md`
is the *process* retro. The route map block is unblocked by M24 but unbuilt and
unowned.

**Operator items: both done** (verified 2026-09-27, three days after this file
last called them outstanding). Production has `0000`-`0031` (runs #29/#30), and
`EXTERNAL_DATA_CONTACT` is set for all three Vercel targets. Migration state is
now `pnpm state`'s computed `PROD MIGRATIONS` line; don't restate it here.

Branches cut from `main` before #221 still carry the part-3 version of
`m14-notebook-widgets.spec.ts` *"a sentence inserted mid-sentence…"*. That
version fails about 3 times in 20: it types into a repeat node view before
React has mounted its editable line, and loses the first keystrokes. Merge
`main` into those branches; `main`'s version passed 20 of 20. Known carriers
are `claude/optimistic-shannon-tce4t8` and `claude/ecstatic-villani-13d488`.
The mechanism is in `docs/guidelines/testing.md` § *Copy these → E2E*.
