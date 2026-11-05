### KI-2026-11-05-b — read-only notebook pages drop inline bold, italic and links

- **Severity:** cosmetic, but content is lost on the reader's screen.
- **Area:** `apps/web/src/components/pages/editor/ReadOnlyPageDoc.tsx`, the shared read-only renderer, used
  by the public page (`PublicNotebookScreen.tsx`) and by viewer mode (`PageScreen.tsx`). The public view's
  server side (`apps/web/src/server/access/publicView.ts`, `PLAIN_MARKS`) ships bare bold, italic, strike
  and code, and no link.
- **Symptom / What happens:** text an editor made bold or italic, or linked, reads as plain text to a
  stranger on `/n/<token>` and to a viewer. It predates M58.
- **Why not fixed here:** scope (PR 693). Mitchell, 2026-11-05: file it.
- **Fix path:** draw the marks in `ReadOnlyPageDoc`. For the public page, keep the server's allow-list and
  decide separately whether a link's `href` may be sent to a stranger (it is data the publisher typed).
  A test that renders a bold, an italic and a link mark and fails without them.
- **Tripwire:** anyone reporting that a shared page reads differently from the editor.
- **Cross-reference:** PR 693, M58 decision 5.
- **First noted:** 2026-11-05, from the PR 693 review.
