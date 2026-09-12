### KI-2026-09-07-c — the assistant composer is `disabled` while a turn is in flight, which blurs it and silently drops a follow-up typed during the wait — RESOLVED

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

---

**RESOLVED 2026-09-12 — fix path 1 taken, the cheapest one: the composer is no longer `disabled` at all.**

**Reproduced first**, since the entry's own claim ("not verifiable in the unit lane") only covers *proving the fix* — the underlying browser mechanism is reproducible directly, without the app. A standalone real-Chromium session (Playwright, headless) focused a plain `<input>`, then flipped `.disabled = true` and back:

```
[
  [ "t0",             true  ],            // input focused
  [ "after-disable",  false, "BODY" ],    // disabling it blurred it to <body>
  [ "after-reenable", false, "BODY" ]     // re-enabling did NOT restore focus
]
```

This is the exact mechanism the entry's PR #155 trace measured (`BODY` at `t=13`, still `BODY` at `t=89` and for the remaining 8s), reproduced independently against current Chromium — the defect was real and current, not something already fixed or version-specific.

The repo's own unit suite additionally encoded the bug as a passing assertion: `AssistantRail.test.tsx`'s `"disables the Ask input/button and shows a busy label while asking"` asserted `input.disabled === true` while `asking` — i.e. it was a green test *for* the defect, not a test that could ever catch it (jsdom does not blur on `disabled`, so this could only ever be a spec-shaped check, never a focus-loss check).

**Fix:** removed `disabled={asking}` from the composer `<Input>` in `apps/web/src/components/assistant/AssistantRail.tsx`. `submitAsk` already refuses to send while `asking` is true, and the Ask `<Button>` stays `disabled={asking || ask.trim() === ""}`, so nothing downstream needed the input itself gated — leaving it enabled keeps focus (nothing calls `.disabled = true` on it anymore, so the browser mechanism above never fires) and keeps whatever the user typed. **It does not auto-send it**, and that is worth stating precisely because option 1 above offered "queue or discard on submit": `submitAsk` still opens with `if (ask.trim() === "" || asking || threadFull) return;`, so an `Enter` pressed mid-turn remains a no-op and the text waits in the composer for the user to send it. What changed is that the keystrokes survive at all — previously they went to `<body>` and were discarded. Auto-sending a follow-up the user never re-confirmed would be a behaviour change this entry did not ask for, so it was not taken.

**Proof:**
- Re-ran the Chromium mechanism reproduction above: with the code fix in place, `AssistantRail`'s composer is never assigned `disabled`, so the disable→blur→no-restore chain has no trigger left to fire from.
- Updated the unit test that had been asserting the buggy behaviour (`AssistantRail.test.tsx`) to assert the corrected invariant instead — composer stays enabled, button stays disabled — and watched it fail for the right reason against the pre-fix code (`expected false to be true` on `input.disabled`), then pass after the fix:
  ```
  Test Files  1 passed (1)
       Tests  39 passed (39)
  ```
- `PageAssistant.test.tsx` (the file whose own comments document this KI in detail) still passes unchanged: 10/10.
- Check subset (`minimal-check-subset`, both changed files under `apps/web`, neither under `packages/contracts/src`): `pnpm --filter web typecheck`, `pnpm --filter web lint`, and `pnpm --filter web exec vitest run -c vitest.unit.config.ts src/components/assistant/AssistantRail.test.tsx src/components/pages/PageAssistant.test.tsx` — all clean (49/49 tests, no typecheck or lint errors).

**Regression test:** yes — `AssistantRail.test.tsx`'s renamed test (`"shows a busy label and disables the Ask button while asking, but leaves the composer itself enabled"`) now asserts `input.disabled === false` during `asking`, which fails immediately if `disabled={asking}` (or any equivalent) is reintroduced on the composer. It does not, and cannot, assert the focus-retention property itself — that half remains real-browser-only, per this entry's own "not verifiable in the unit lane" note, and is covered instead by the mechanism reproduction above (there is nothing left in the component that can trigger it).
