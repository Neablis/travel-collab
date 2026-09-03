### KI-2026-09-03-c — the "select a day" chip is a button with nothing behind it, between M14 links 2 and 4

> **RESOLVED 2026-09-03, in the same PR that filed it (#129).** Filed as a
> deliberate leave-it, then fixed after **both reviewers independently flagged
> it** — CodeRabbit and Copilot, on a defect this entry already described. Two
> reviewers landing on the same left-behind thing is the signal that "small, and
> link 4 undoes it anyway" was the wrong call.
>
> **The fix is not the one this entry proposed, and that is why it survives
> link 4.** The interim suggested here was to change `tone="action"` to
> `tone="muted"` outright, which link 4 would have had to undo. What landed
> instead makes the tone conditional on the handler: `MacroView` renders the
> actionable chip when it is given an `onBindDay` and an inert `no day set`
> chip when it is not. Link 4's chrome row passes a handler again, and the
> actionable chip returns **with no further edit**.
>
> `MacroView.test.tsx`'s single unbound test was replaced by two, because the
> old one asserted only the chip's text while calling it "actionable" — so it
> passed just as happily once the button went dead. The pair now assert the
> button exists with a handler and that no button exists without one. Both were
> watched failing: `Unable to find an element with the text: no day set`, and
> the actionable case against a restored unconditional `action` tone.
>
> The underlying limitation this entry also mentions — that nothing on the page
> can rebind a widget until link 4 — is **not** resolved and was never a defect.
> It is link 4 not being built yet, and the milestone tracks it.

- **Severity:** cosmetic, shading into correctness of affordance — the chip *looks* clickable, is a real `<button>`, is reachable by keyboard, and does nothing at all when activated. Nothing is lost or corrupted; a user is invited to act and then ignored.
- **Area:** `apps/web/src/components/pages/MacroView.tsx:21` — `<EmptyChip tone="action" label="select a day" onClick={onBindDay} />`; `EmptyChip.tsx` renders `action` tone through the `Button` primitive; `PageScreen.tsx` no longer passes `onBindDay`, so `MacroEditorContext`'s value for it is `undefined` all the way down through `PageEditor` → `MacroNodeView` → `MacroView`.
- **What is wrong:** M14 link 2 removed the page-level day binding (`PageContext.dayRef`, the "This page is about" dropdown, `DayBindingControl`) because SPEC §18 struck it. `onBindDay` used to focus that dropdown. The dropdown is gone; the chip that pointed at it is not. So an `itinerary.day` or `cost.day` widget with no `dayRef` in its params still resolves `unbound`, still renders "select a day", and clicking it is inert.
- **Why it was left rather than fixed:** the replacement is **M14 link 4** — the Editing-mode chrome row, where a bound widget wears its own bind selects (ADR-035 decision 3, SPEC §18 "Binding at insert and rebinding later are the same act"). Fixing it *properly* here means building link 4 inside link 2's PR; fixing it *cheaply* means degrading the chip to a muted non-button, which is a second edit link 4 immediately undoes. Neither is worth it for a state that is currently hard to reach — see below — so the affordance was left honest-looking-but-dead **and written down** rather than silently shipped.
- **How reachable is it, actually:** not very, today. Neither seeded template plants a macro node (`packages/pages/src/templates.ts` is plain prose since M8), so a fresh trip's pages cannot show it. It needs a page carrying an `itinerary.day` or `cost.day` node with no day in its params — which today means one drafted by the assistant's `compose_page`, whose instruction now explicitly warns the model off day macros for exactly this reason (`handleAskRequest.ts`, `pageInstructions`). So: reachable, not common.
- **Fix path:** delete the `onBindDay` prop chain (`MacroView`, `MacroNodeView`, `MacroEditorContext`, `PageEditor`) as part of **link 4**, and let the chrome row own rebinding. If link 4 slips far enough that this becomes user-visible in a demo, the interim fix is one line — change `tone="action"` to `tone="muted"` with the label "needs a day", which drops the `Button` and the false affordance with it.
- **Cross-reference:** `docs/milestones/M14-rich-layer.md` links 2 and 4, `docs/architecture/ADR-035-widgets-are-functions-of-declared-inputs.md` decision 3, `.design-sync/handoff/SPEC.md` §18.
- **First noted:** 2026-09-03, by the implementer of link 2, as the known cost of landing link 2 before link 4.
