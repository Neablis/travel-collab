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
- **Finding (2026-11-14): defence in depth, the upgrade can wait.** The fix direction's first
  question has an answer: no stored `PageDoc` carries an own `__proto__` attribute key to the
  editor. `apps/web/src/server/pages.test.ts` sends one through the real write path: the BFF
  route's `readBody(CreatePageInput)`, the command's re-parse, `checkPageDocForWrite` and
  `serializePageDoc`, up to the stored JSON.
  - Every strict position the editor mounts refuses it with a 400: a node, a node's `attrs`
    (heading), a mark, and a widget's `attrs`.
  - The two open records, mark `attrs` and widget `params`, are `z.record`. It assigns each key
    onto a fresh object, so `__proto__` sets that object's prototype instead of becoming a key,
    and serialising drops it. The stored document has no own `__proto__` anywhere.
  - It survives only inside a node type this build does not know, kept byte-identical by
    ADR-038 decision 3. Read back, that node is `{ type: "unknown", raw }`, with no `attrs` for
    ProseMirror to read, and `inspectStoredPageDoc` opens the page read-only. ProseMirror also
    builds a node's attrs only from the names its extension declares, and none is `__proto__`.
  - Nothing was stripped, because nothing reaches `mergeAttributes`. Stripping inside an unknown
    node's `raw` would also break decision 3's byte-identical promise, and that schema lives in
    `packages/contracts/src`.
  - Seen red: a temporary line in `checkPageDocForWrite` that planted an own `__proto__` on a
    widget's params failed the test (`expected [ '$.content.0.attrs.params' ] to deeply equal
    []`). `pnpm audit` still lists the advisory on this date, so the entry stays open.
