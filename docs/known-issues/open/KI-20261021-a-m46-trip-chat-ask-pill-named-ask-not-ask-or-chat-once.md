### KI-2026-10-21 — `m46-trip-chat.spec.ts:77` once found the owner's Ask pill named "Ask", not "Ask or chat", then passed on retry

- **Severity:** reliability. One e2e red that passed on retry; no product behaviour is known to
  be wrong. Seen once.
- **Area:**
  - `apps/web/e2e/m46-trip-chat.spec.ts:77`:
    `await expect(page.getByTestId("ask-pill")).toHaveAccessibleName("Ask or chat")`, on the
    owner's page opened once the trip has two members.
  - `apps/web/src/components/nav/askOrChat.tsx:14` (`askOrChatName`): `unread === undefined`
    gives no label, so the visible "Ask" is the name.
  - `apps/web/src/components/assistant/AskPill.tsx:96` and its `unread` prop from
    `apps/web/src/components/trip/TripHeader.tsx:587`.
- **Symptom / What happens:** `toHaveAccessibleName("Ask or chat")` failed, receiving `"Ask"`,
  then the test passed on retry. Seen while working PR 513 (M51 part 9) at `07f1f68`, a PR that
  touches no chat or assistant code.
- **Cause (reasoned, not reproduced):** the pill is named "Ask" until the page knows the trip
  has a chat (`unread` defined). If the owner's page still saw one member, or its unread count
  had not arrived, within the expect timeout (5 s on CI), the name stays "Ask". Not yet told apart
  from a load timeout: rule 2 of CLAUDE.md applies, so check whether a second sighting fails in
  the same place.
- **Why not fixed here:** seen on a part that does not touch this code; filed from M51's prose-only
  part 0.
- **Fix direction:** find what sets `unread` on the owner's trip page, and either wait in the spec
  for the signal that makes it defined (the members or unread read) before asserting the name, or
  make the page define it from the first render when the trip has more than one member. Prove it
  red first by delaying that read.
- **Cross-reference:** KI-2026-10-14-c (one-off CI reds); M46 (the combined Ask and chat button).
- **First noted:** 2026-10-21, M51 part 9 (PR 513) at `07f1f68`.
