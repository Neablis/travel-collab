### KI-2026-09-05-aa — `SPEC.md` §23 and `DRIFT.md` §2i both assert the phone has no assistant; it has one on three of four screens

- **Severity:** documentation / handoff correctness — **confirmed**. No user-visible symptom. The cost is to the next build session, which inherits a false premise about what exists and may re-implement or delete working code.
- **Area:** `.design-sync/handoff/SPEC.md` §23, `.design-sync/handoff/DRIFT.md` §2i, and the README's "what is new" summary. The code they describe is `apps/web/src/components/board/TripBoardScreen.tsx:941`, `apps/web/src/components/pages/PageScreen.tsx:363`, `apps/web/src/components/assistant/AssistantRail.tsx`, and `apps/web/src/app/globals.css` (`.assistant-rail`).
- **Symptom / What happens:** §23 opens *"§9 gave the assistant three presentations, all of them desktop… The phone had none, and no entry point at all."* §2i restates it as fact — *"the code has no phone assistant either — so this is design ahead of build, not a disagreement."* Both are wrong. What is actually in the tree:

  | Phone screen | Entry point | Opens as |
  |---|---|---|
  | Plan | `◎ Assistant`, full-width button at the end of the plan column | full screen |
  | Map | the same button (it is inside `.trip-board-content`, so it rides every lens) | full screen |
  | Notebook index | **none** — this screen genuinely has no assistant | — |
  | Open page | `◎ Assistant` in the page action row, beside "Edit page" | full screen |

  §23 is right that the entry point is inconsistent — three placements, two labels, one screen with none — and that half of the design is answering a real problem. The premise that there is *nothing* is what is false.

- **Second-order consequence, and the more expensive one:** because §23 believes it is designing onto a blank surface, it does not cite the two issues that produced the current shape, and it reverses one of them. `KI-84` (PR #88 preview, Mitchell on his own Android phone: *"the AI assistant on mobile breaks the entire website, it probably shouldn't be a modal but a full page experience"*) is why the rail is full-screen below 768px. `KI-2026-08-30` is why the launcher sits in normal flow (SPEC §13.5, "no floating action button"). §23 specifies a `max-height: 80%` modal sheet — the category KI-84 rejected — without noting that it is a reversal. `apps/web/e2e/m16-mobile-assistant.spec.ts` pins the full-screen geometry in four assertions.
- **Disposition:** Mitchell was shown the conflict on 2026-09-05 and **chose to build §23 literally, sheet and all**, with the e2e assertions rewritten and the reversal recorded. So the geometry question is settled and is not what this entry tracks. This entry tracks the **documentation defect** only.
- **Why not fixed here:** `.design-sync/handoff/` is design-owned and regenerated wholesale — its README says the folder "is rewritten in place" and is committed "replacing the previous bundle". A correction written into `DRIFT.md` or `SPEC.md` from the build side is discarded by the next design pass, so the build cannot fix this in place. It has to go back through the design pass.
- **Suggested next step:** on the next design sync, correct §23's opening and §2i's "the code has no phone assistant either" to describe the three existing entry points, and add the KI-84 reversal to §2i's "what a build owes" so the decision is visible to whoever reads it next. Until then, this entry is the correction of record.
- **Cross-reference:** `KI-84`; `KI-2026-08-30`; `DRIFT.md` build-check 4c (the scrim must cover the tab bar); `DRIFT.md` §8 (the two holes §23 leaves undesigned — the Free-tier state of the pill, and the missing "Save this day as a Playbook" phone entry point); `SPEC.md` §13.5.
- **First noted:** 2026-09-05, opening the §23 build — the first read of the code the design claimed did not exist.
