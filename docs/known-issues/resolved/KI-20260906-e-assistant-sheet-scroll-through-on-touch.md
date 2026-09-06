### KI-2026-09-06-e — the assistant sheet let the plan behind it scroll (RESOLVED 2026-09-06)

- **Severity:** correctness. Reported from a physical Android device; **reproduced in CI**, not in this container.
- **Status:** RESOLVED on `claude/vercel-preview-access-oyw3vv`.
- **Area:** `apps/web/src/components/assistant/AssistantRail.tsx` — the `sheet` presentation (`RadixDialog.Root open` … `RadixDialog.Content` at `display: contents`), and its transcript scroller.
- **The report:** Mitchell, 2026-09-06 preview, Chrome 152 on Android at 412×761: *"when the assistant overlay is open, you are still scrolling the background rather than the assistant chat"*. The sheet is `max-height: 80dvh` anchored to the bottom, so roughly a fifth of the screen above it is still the plan.
- **What was checked, and what it ruled out.** A phone-project e2e was written for it (`m16-mobile-assistant.spec.ts`, "an open sheet does not let the plan behind it scroll"). With a real wheel gesture over the plan above the sheet, the page **does not** move — and it still does not move when a document-level `overflow: hidden` lock is deleted. So `RadixDialog.Root`'s modal `react-remove-scroll` is already refusing wheel, and a second lock adds nothing on that path.
- **A wrong turn worth recording, because it looked like a reproduction.** The first version of that test drove `document.scrollingElement.scrollBy(0, 400)` and reported the page moving from 42 to 442 with the sheet open. That is not a scroll-lock failure: **programmatic scrolling works through `overflow: hidden` by design** — it only refuses the user. The probe would have reported the bug present with any lock in place, and reported it fixed by nothing. Any future attempt on this should use a gesture (`mouse.wheel`, or a touch sequence), never `scrollBy`.
- **What is therefore still unknown:** whether touch behaves like wheel here. `react-remove-scroll` handles `touchmove`, but passive listeners, Android's URL-bar collapse, and the visual-viewport shift all move pixels in ways a person reasonably describes as "the background scrolled". None of them is reachable from Playwright's desktop Chromium.
- **What shipped anyway, and why only this much:** `overscroll-contain` on the transcript scroller. It is correct for any scrollable panel inside an overlay independent of what the modal lock does, and chaining off the end of the transcript is the mechanism most likely to produce this symptom under touch. It is **not** verified against the report and is not claimed as the fix.
- **What would resolve it:** a real device or a touch-capable harness. Failing that, ask for one more detail — whether the plan moves when dragging on the strip *above* the sheet, or only when dragging *inside* the transcript and continuing past its end. Those two point at different mechanisms and the answer costs nothing to give.
- **Cross-reference:** `docs/design-feedback/2026-09-06-preview-ui-feedback.md` finding 15.
- **First noted:** 2026-09-06.

---

## Resolution, 2026-09-06 — and a second wrong turn, in the opposite direction

The entry above records a claimed reproduction that was an artefact. It then
made the opposite mistake and was more confident about it: **"with a real wheel
gesture the page does not move — and it still does not move when the lock is
deleted"**. That was measured, and it was still wrong.

CI failed the same walk on `2bcc8a4`: the plan behind the open sheet went from
scrollTop 42 to 442 on a 400px wheel, on the first attempt and again on the
retry. Deterministic there, green here.

**Why the walk passed in this container.** It wheeled the page down 400px to
prove the gesture works, and on a 412px viewport this app's plan has only a few
hundred pixels of scroll range — so the page was already pinned at its maximum
before the sheet was even opened, and the assertion that it "did not move"
could not have failed however broken the lock was. CodeRabbit flagged the
vacuity by reading, on PR 149, hours before CI proved it by running. The walk
now proves the gesture scrolls, returns the page to 0, checks there is room
left, and only then opens the sheet.

**The defect.** `document.scrollingElement` is `<html>` in standards mode.
`react-remove-scroll`'s scrollbar lock sets `overflow: hidden` on `<body>`,
which does not stop the viewport scroller when that scroller is the root
element; its wheel handler is a second, event-level defence, and that is the
one that evidently holds in this container's Chromium and not in CI's. Either
way the sheet was relying on a library's incidental behaviour for something it
should assert itself.

**The fix.** `AssistantRail` locks `document.documentElement`'s overflow for as
long as the sheet presentation is mounted, restoring the previous value on
unmount. `overscroll-contain` on the transcript stays: it is right on its own
terms and covers the chain-off-the-end path, which is a different mechanism.

**Still not verified on a physical device**, and the touch path is still
untested here for the reasons above. What changed is that the root scroller can
no longer scroll at all while the sheet is open, by construction, rather than
by a library's leftover.

**The lesson, which cost two turns:** a walk that passes proves nothing until
you have seen it fail. Both wrong turns here were a green assertion trusted
without a red one.
