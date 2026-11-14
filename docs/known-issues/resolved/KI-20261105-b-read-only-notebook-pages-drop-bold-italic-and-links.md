### KI-2026-11-05-b — read-only notebook pages drop inline bold, italic and links — RESOLVED

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
- **Resolution (2026-11-14):** both renderers in `ReadOnlyPageDoc.tsx` (`ReadOnlyPageDoc` and the public
  `PublicPageDoc`) now draw a text node's marks through one `MarkedText`: bold, italic, strike and code,
  nested when a run carries several, and a link only for an absolute `http:`, `https:` or `mailto:` href,
  with `rel="noopener noreferrer"`. Any other href (`javascript:`, `data:`, a relative path) keeps its text
  and loses the anchor. The public server's `PLAIN_MARKS` allow-list is unchanged, so a stranger still
  gets bare bold, italic, strike and code and never a link's `href`. Whether a link may be sent to a
  stranger is still undecided. Proven by `ReadOnlyPageDoc.test.tsx`: against the old renderer it failed
  with `Unable to find an element with the text: loud` and `expected [ 'DIV', 'P' ] to deeply equal
  [ 'EM', 'STRONG' ]`. With `safeHref` changed to return any href, the five unsafe-href cases failed
  (`expected <a href="data:text/html,hi" …(3)></a> to be null`).
