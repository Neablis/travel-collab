### KI-2026-09-05-aa — `SPEC.md` §23's unification plan is right; the one sentence describing what it unifies is wrong, and that is what hid a KI-84 reversal

- **Severity:** documentation / handoff correctness — **confirmed**. No user-visible symptom, and **no defect in the design's plan**. The cost is that a build reading §23 cannot see that it is reversing an earlier decision.
- **Area:** one sentence in `.design-sync/handoff/SPEC.md` §23, its restatement in `DRIFT.md` §2i, and the README's summary of both.
- **The plan is correct and was built as written.** §23's goal is to **unify an assistant that had drifted apart across the app**: *"Same pill, same label, same position, so it never moves as you change tabs."* That inconsistency was real and worse than the design knew — three entry points, in three different places, under two different labels, with one screen missing it entirely:

  | Phone screen | Entry point before §23 | Placement | Opened as |
  |---|---|---|---|
  | Plan | `◎ Assistant` | end of the plan column | full screen |
  | Map | the same button (inside `.trip-board-content`, so it rides every lens) | end of the plan column | full screen |
  | Notebook index | **none** | — | — |
  | Open page | `◎ Assistant` | page action row, beside "Edit page" | full screen |

  Desktop had its own three presentations (§9: docked rail, floating panel, collapsed bubble). So the assistant had **six** presentations across the app before this. Unifying the phone's four into one pill is exactly the right call, and it is what shipped.

- **What is actually wrong:** §23 opens *"The phone had none, and no entry point at all"*, and `DRIFT.md` §2i restates it as fact — *"the code has no phone assistant either — so this is design ahead of build, not a disagreement."* Three of the four screens had one. The sentence understates the problem it is solving.
- **Why that sentence matters, and it is not pedantry.** Believing the surface was blank is what let §23 specify a `max-height: 80%` modal sheet **without noting that it reverses `KI-84`** — Mitchell's own report, on his own Android phone, that *"the AI assistant on mobile breaks the entire website, it probably shouldn't be a modal but a full page experience"* — or `KI-2026-08-30`, which put the launcher in normal flow under SPEC §13.5's no-FAB rule. `apps/web/e2e/m16-mobile-assistant.spec.ts` pinned the full-screen geometry in four assertions. A design that knows it is reversing a decision says so; a design that thinks it is filling a void cannot.
- **Disposition:** Mitchell was shown the reversal on 2026-09-05 and **chose to build §23 literally, sheet and all**. Built in PR #148; the e2e assertions were rewritten with the KI-84 → KI-2026-08-30 → §23 sequence recorded in that file's header. The geometry question is settled and is **not** what this entry tracks. This entry tracks only the stale sentence, so the next reader of §23 can see the reversal it does not mention.
- **Why not fixed here:** `.design-sync/handoff/` is design-owned and regenerated wholesale — its README says the folder "is rewritten in place" and is committed "replacing the previous bundle". A correction written into `SPEC.md` or `DRIFT.md` from the build side is discarded by the next design pass.
- **Suggested next step:** on the next design sync, replace §23's "the phone had none, and no entry point at all" with what was actually there (the table above), and add the KI-84 reversal to §2i's "what a build owes". Nothing else in §23 needs to change.
- **Cross-reference:** `KI-84`; `KI-2026-08-30`; `KI-2026-09-05-ac` (three affordances now share the name `Ask` — a consequence of unifying onto one word); `DRIFT.md` build-check 4c; `DRIFT.md` §8 (the two holes §23 leaves undesigned: the Free-tier state of the pill, and the missing "Save this day as a Playbook" phone entry point); `SPEC.md` §9, §13.5.
- **First noted:** 2026-09-05, opening the §23 build.
