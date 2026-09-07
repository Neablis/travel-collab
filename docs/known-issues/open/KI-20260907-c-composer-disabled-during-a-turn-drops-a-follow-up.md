### KI-2026-09-07-c — the assistant composer is `disabled` while a turn is in flight, which blurs it and silently drops a follow-up typed during the wait

- **Severity:** correctness (user-visible input loss). Smaller than the defect it was found next to — the keystrokes are dropped rather than written into the user's document — but they are still lost with no feedback, and the `Enter` that would have submitted them is lost with them.
- **Area:** `apps/web/src/components/assistant/AssistantRail.tsx:592` — `disabled={asking}` on the composer `<Input>`. Every surface that mounts the rail inherits it.
- **What is wrong:** while a turn is in flight, `asking` is true and the composer is `disabled`. **Disabling a focused input blurs it**, and re-enabling it does not restore focus. So a user who asks something and keeps typing loses everything typed from that moment: the characters go to `<body>` and are discarded, and the `Enter` never submits.
- **Measured in a real browser** (Chromium, local production build, PR #155's preview walk 2026-09-07), tracing `document.activeElement` from the moment Enter is pressed:

  ```
  t(ms)  activeElement  composer.disabled
     13  BODY           true
     89  BODY           false
        (BODY for the remaining 8 seconds — no further transitions)
  ```

  The input is re-enabled after ~76ms and focus never comes back to it.
- **How it was found, and why it was not found sooner.** It sits directly underneath **KI-2026-09-06-b** (resolved 2026-09-07), which was the *destructive* half of the same moment: before that fix, tiptap's `requestAnimationFrame` pulled focus into the editor a frame after an insert rendered, so the follow-up was typed into the notebook document **and autosaved to the server**. That fix stops the editor taking the caret. What it cannot do is give the caret back to a composer that React disabled — a different component, a different cause.

  **The net change is still strictly an improvement**: silently dropped beats silently written into the user's document. KI-2026-09-06-b is legitimately closed; this is the remainder.
- **Why no test caught it, which is the part worth keeping.** `PageAssistant.test.tsx` covers this exact moment, and **jsdom does not reproduce the blur** — there the composer keeps focus and the follow-up is delivered whole. The regression test added by KI-2026-09-06-b was originally named *"keeps a follow-up typed while an insert lands **in the composer**, not in the page"*, and the first half of that name was false in every real browser while passing in CI. It has been renamed and annotated (PR #155) so it claims only the property that holds in both: the keystrokes never reach the page document.

  This is the `docs/guidelines/testing.md` "prove it at one layer" problem seen from the other side — the layer that owns *focus* is the browser, and no jsdom test can own it.
- **Fix path, cheapest first:**
  1. **Do not disable the composer at all** — keep it editable during a turn and queue or discard on submit. `asking` still gates the submit button, which is what actually needs gating. This is the smallest change and removes the blur entirely.
  2. **`readOnly` instead of `disabled`.** A read-only input keeps focus and keeps its value; it just refuses edits. Semantically closer to what is meant, but still discards the keystrokes.
  3. **Restore focus when `asking` goes false** — an effect that re-focuses the composer if it held focus when the turn started. Works, but it is the fragile option: it races the same way the original defect did, and it needs to not steal focus from a user who deliberately clicked into the document.
  Option 1 is preferred; whether a follow-up typed mid-turn should be *queued* or simply preserved as text is a product question for Mitchell.
- **Not verifiable in the unit lane.** Any test for this has to run in a real browser — jsdom fabricates the passing case. That makes it e2e or nothing, and `docs/guidelines/testing.md`'s locator ladder applies.
- **Cross-reference:** **KI-2026-09-06-b** (resolved — the destructive half, and the walk that found this); **KI-2026-09-05-a** (the other open entry about this editor's selection behaviour); PR #155.
- **First noted:** 2026-09-07, by the `phase-verifier` browser walk on PR #155 — found in a real browser precisely because the unit lane cannot see it.
