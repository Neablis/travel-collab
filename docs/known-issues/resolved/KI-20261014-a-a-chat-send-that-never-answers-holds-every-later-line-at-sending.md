### KI-2026-10-14-a — a chat send that never answers holds it, and every line sent after it, at "Sending…" — RESOLVED

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
- **Resolved 2026-10-25 (KI sweep), the fix this entry named, after ADR-066.** A send now carries
  a key, and a stalled send now times out. `PostChatMessage.clientKey` (an optional uuid) is the
  send's own key. Migration **`0067_chat_client_key`** adds `trip_messages.client_key` and the
  partial unique index `trip_messages_client_key (trip_id, author_id, client_key) where client_key
  is not null`. `postMessage` (`server/chat/messages.ts`) inserts on conflict do nothing. A repeat
  by the same poster is answered 201 with the message already stored. It stores no row, moves no
  `chatRev`, and the route starts no second `@assistant` turn for it (`created: false`).
  `postChatMessage` takes `AbortSignal.timeout(CHAT_POST_TIMEOUT_MS)`, which is 15s. A stalled
  head now fails through the hook's existing `status === 0` branch, and the sends behind it come
  back with it, as in PR 550. `useTripChat` mints one key per send. A send that comes back keeps
  its key, and sending the same words again reuses it.
  **Reproduction:** a new hook test, *"go back together when the first never answers, once its
  timeout passes"*. Its POST handler never answers. With three lines sent and 15s passed, the
  test failed `expected [ 'message 1', 'Train at nine?', …(2) ] to deeply equal [ 'message 1' ]`:
  all three lines were still pending, and only the first had been sent.
  **Red-then-green:** that test fails the same way with the `signal` commented out of
  `postChatMessage`. It stubs `AbortSignal.timeout` onto the faked `setTimeout`, because Node's
  own does not run on vitest's fake timers. *"sends a retry of the same words under the same key…"*
  fails `expected '36fc…' to be '0ece…'` with the hook minting a fresh key every time. In
  `chat.int.test.ts` *"a keyed send"*, three of the five tests fail with `postMessage` ignoring
  the key: the repeat, the repeated `@assistant` and the race each stored a second message with a
  new id. All of them pass restored.
  **Checks:** `pnpm typecheck` passes across all seven packages. `pnpm lint` passes with CI's
  `NODE_OPTIONS=--max-old-space-size=4096`, and `check-migration-journal` OK. The unit tests in
  `components/chat/` pass 83/83, and `apiClient` with `changeLine` pass 197/197. The contracts
  `chat.test.ts` passes 13/13. The full `test:int` passes 138 files and 1837 tests. The e2e spec
  `test:e2e:ci-like e2e/m46-trip-chat.spec.ts` passes 4/4.
  **Migration `0067_chat_client_key` must be dispatched to production after merge.** Until it is,
  every `trip_messages` read and write names a column production does not have yet, so the chat
  answers 500. Change lines are best-effort and do not fail the trip edit.
