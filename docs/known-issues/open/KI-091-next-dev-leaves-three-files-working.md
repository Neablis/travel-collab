### KI-91 — `next dev` leaves three files in the working tree that are not ours and are not ignored
- **Severity:** cleanup (no product impact; it puts unrelated files in front of every `git add` on a branch where someone ran the dev server)
- **Area:** `.gitignore`, `apps/web/next-env.d.ts`
- **What happens:** starting `pnpm --filter web dev` (Next 16, Turbopack) writes `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` — vendor "agent rules" files from the `next` package, untracked and unignored — and rewrites the tracked `apps/web/next-env.d.ts` to point at `./.next/dev/types/...` where the committed version points at `./.next/types/...`. `next build` points it back. So `git status` on any branch is dirty in three places after a browser check, and the two `.md` files sit directly beside a real `AGENTS.md`/`CLAUDE.md` convention this repo uses for its own instructions — which is exactly the pair a hurried `git add apps/web` would sweep in.
- **Why it matters more here than it looks:** this repo's operating manual IS `AGENTS.md`, and a vendor file with the same name one directory down is a genuine trap for a future session reading either.
- **Fix path:** ignore all three (`apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, and — if the dev/build flip is unavoidable — decide which spelling of `next-env.d.ts` is committed and ignore the other). Next's own docs cover suppressing the agent-rules files; that is worth checking before ignoring them, since not writing them at all is better than ignoring them.
- **Found by:** the M11-fallout KI cluster, 2026-08-29, doing KI-64's browser verification. The three files were kept out of that PR by hand.
- **First noted:** 2026-08-29.

- **Numbering:** filed as 78 on 2026-08-29, when several sibling branches each filed a different KI-77/78 the same night. Renumbered to 91 on merge. Nothing outside this file references it.
