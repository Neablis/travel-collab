### KI-2026-10-18-b — `@tiptap/core` 2.x carries GHSA-cp6q-959q-f8rh, and the only fix is tiptap 3

- **Severity:** moderate (the advisory's own rating). Security, in the notebook editor.
- **Area:** `apps/web` → `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm` (all `^2.27.x`),
  through `@tiptap/core`. Used by the notebook editor under `apps/web/src/components/pages/editor/`
  and `components/pages/PageScreen.tsx`.
- **Symptom:** `pnpm audit` reports *"Tiptap: mergeAttributes() turns an own `__proto__` key into
  inherited executable DOM attributes"* (GHSA-cp6q-959q-f8rh), vulnerable `>=2.0.0-alpha.0
  <3.30.4`. It is one of the two advisories left after PR 481 took 29 down to 2. The other is
  `braces`, lint-time only.
- **Why it matters here:** notebook documents are written by trip members and rendered for every
  member, so attributes in a stored document reach other people's browsers. Whether a crafted
  `__proto__` key can reach `mergeAttributes` through the editor's own extensions and the server's
  `PageDoc` validation has not been checked.
- **Why not fixed in PR 481:** no 2.x release carries the fix. Tiptap 3 is a major migration (23
  files), and `dependabot.yml` sends majors to their own planned branch. It is listed in
  `docs/candidates.md` under *The major upgrades Dependabot is told to skip*.
- **Fix direction:** first, check whether a stored `PageDoc` can carry an own `__proto__`
  attribute key past the server's schema. If it can't, this is defence in depth, and the upgrade
  can wait for the migration. If it can, strip such keys at the schema now and do the upgrade
  soon. Move this entry to `resolved/` when `pnpm audit` no longer lists the advisory.
- **First noted:** 2026-10-18, PR 481.
