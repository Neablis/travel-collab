### KI-2026-10-21-a — `m46-trip-chat.spec.ts:77` once found the owner's Ask pill named "Ask", not "Ask or chat", then passed on retry — RESOLVED

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
- **Resolved:** 2026-10-25, KI sweep 2. The cause was the spec's wait, not the page.
  `await expect(bea.getByRole("heading", { name: tripName, level: 1 })).toBeVisible()` after
  *Join the trip* proves nothing: the invite landing's own `<h1>` is the trip's name
  (`InviteLandingScreen.tsx`), so it passes before the accept has answered, and the owner's page
  could load while the trip still had one member, where `tripHasChat` is false and
  `askOrChatName(undefined)` names the pill "Ask" (correctly). The page recovers only once its
  2s poll sees the `accessRev` move and re-reads access. Reproduced by holding the accept 15s on
  Bea's context under `test:e2e:ci-like`: `Expected: "Ask or chat" / Received: "Ask"` at the same
  line, on the run and its retry. Fix (`e2e/m46-trip-chat.spec.ts`): a `join` helper that clicks,
  waits for the trip's own URL (the landing leaves for it only once the accept is ok,
  `useInviteJoin`), then the heading; used at all three join sites in the spec (the third closes
  Bea's context right after, which could also abort the accept). `askOrChat.tsx` unchanged. Proof:
  with the accept held 3s the new walk passes; and the ci-like run of `m42-demo-trips`,
  `m37-trip-covers`, `m46-trip-chat`, `m14-notebook-widgets` and `responsive`, 104 passed, none
  flaky. The same heading-only wait after *Join the trip* is in `travellers.spec.ts:128` and
  `m52-today.spec.ts:46` (which closes the context next); left alone, reported.
