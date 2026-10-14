### KI-2026-10-14-a — a chat send that never answers holds it, and every line sent after it, at "Sending…"

- **Severity:** reliability. Nothing is lost or stored twice, but the reader is never told. Their
  lines sit at "Sending…" for the life of the page, and the composer stays usable, so they can
  keep adding lines that will never go.
- **Area:** `apps/web/src/lib/apiClient.ts` (`postChatMessage`, a `fetch` with no `signal`) and
  `apps/web/src/components/chat/useTripChat.ts` (`post` and its one-at-a-time `queue`).
- **Symptom:** since PR 444 a sent line shows at once as pending, and each POST starts only when
  the one before it answers, so messages are stored in the order sent. If a POST never answers (a
  connection that stalls rather than drops), the queue's head never settles. That line and every
  line queued behind it stay at "Sending…" with no error, and none of the later ones is sent. A
  re-read on `chatRev` does not help, because a line the server never received has nothing to
  match. Only a reload clears it, and the reload drops the pending text.
- **Why not fixed here:** a timeout alone is not safe. A POST that times out after the server
  stored the message would give its text back, and Send would store it a second time. The fix
  needs a client key per send that the server applies once, as ADR-066 gave trip commands. With
  that key in place, `postChatMessage` can take `AbortSignal.timeout(…)`, and a timed-out head
  fails like any network error (the hook's existing `status === 0` branch).
- **Cross-reference:** KI-5 residual 7
  (`KI-005-optimistic-commands-silently-lost-abrupt-navigation.md`) declined to make the trip's
  sender wait on a drain for exactly this reason: one hung request would wedge every later edit.
  The chat queue does wait, and has the hang that residual predicted. KI-5 does not cover chat, so
  this is a separate entry, not an extension of it. ADR-066 (keyed units). Sibling:
  KI-2026-10-14-b.
- **First noted:** 2026-10-14, M46 walk, PR 444 review (finding 2 of the review of `1208ed3`,
  filed per finding 1 of the review of `c33ef09`).
