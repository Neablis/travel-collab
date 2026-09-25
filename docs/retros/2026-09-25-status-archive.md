# STATUS archive — 2026-09-25

Three closed `## DONE` sections, moved here verbatim and in order from
`docs/STATUS.md`: M12 (2026-09-23), M13 (2026-09-22) and the shared day's map
panel (M26 link 4b, 2026-09-20). Together they were 3,609 B.

Why now: `STATUS.md` had grown to 28,560 B against its 30,000 B budget in
`scripts/surface-size.mjs`, and `surface-size.test.mjs` requires more than 10%
headroom. So `static-and-unit` failed on every PR against `main`. Each of
these milestones is closed, and its milestone file holds its gate and retro.

## DONE 2026-09-23 — M12 Reviews and moderation, gate closed 13 of 13

**The narrative, the evidence behind every box and the retro are in
`docs/milestones/M12-reviews-and-moderation.md`.** Backend #206, UI #212, the
country data #213-#215. SPEC §15's *"every rating here is fixture data"* is no
longer true. **Two things in it are still live and are still instruction:**

1. **A content re-import is owed to production.** The gate-close commit
   corrects three country codes #213 got wrong (Fuente De `MX`→`ES`, Dundee
   `GB`→`US`, Voss `US`→`NO`); until `import-content-production` runs,
   production's *Mexico* still counts a Spanish day
   (`docs/guidelines/content-bundles.md` → *Publishing to production*).
2. **The walked boxes were walked by an agent**, in a real browser against a
   production build on a local database — not by a person on production. The
   retro says so, and lists the design decisions #212 took without a drawing.

**What M26's close does and does not assert** — including the two boxes closed
on attestation and the Definition-of-Done box ticked at 153/2 rather than green
— moved to `docs/milestones/M26-design-parity.md` on 2026-09-22, same gate-close
rule as the section below.

## DONE 2026-09-22 — M13 Collaboration, gate closed 10 of 10

**Moved to `docs/milestones/M13-collaboration.md`** — the five links, the
notebooks-in-the-event-log piece that came with them, and the retro. M13's gate
closed 2026-09-22 and this file's rule is that a phase's narrative moves to its
milestone file at gate close, leaving the pointer. Merged as `#201` (`99f32d3`),
green on CI at `18623fb`; the two-actor walk box is ticked **on Mitchell's
attestation**, recorded as such in the box.

**Four things in it are still live and are still instruction:**

1. **Read `KI-2026-09-22-c` before touching undo.** Wiring `diffPageStates` into
   `decideHistoryCommand` looks like two lines and would delete every notebook on
   a revert. A test pins the safe state; the entry has the trace and three answers.
2. **A page-only batch is deliberately NOT undoable.** `deriveUndoRedo` skips any
   batch with no trip events. Stacking one wedges undo entirely — the trip diff
   comes back empty, the command is rejected `nothing-to-undo`, nothing is popped,
   and every earlier change sits unreachable behind it. The same skip is why a
   notebook save no longer throws away the trip's redo. Both directions are tested.
3. **Any new reader of the log must skip the other aggregate's events BY NAME**,
   never by "whatever fails to parse" — that is what keeps a corrupt stream loud.
   `foldEnvelopes`, `foldPages` and both projections do it; the rebuild path was
   caught missing it only by the full int lane, as five failures that passed in
   isolation.
4. **`KI-2026-09-22-d`** — the notebook EDITOR still does not adopt a
   co-traveller's edit while you are typing in it, deliberately: a re-read would
   clobber in-progress work. It wants link 4's conflict-as-data shape.

## DONE 2026-09-20 — the shared day's map panel (M26 link 4b)

**Moved to `docs/milestones/M26-design-parity.md` on 2026-09-22**, verbatim,
under *The shared day's map panel (link 4b)* — M26's gate closed 2026-09-21, and
this file's own rule is that a phase's narrative moves to its milestone file at
gate close and the pointer stays here. **Two things in it are still live and are
still true**: `gaps[idx].label` is computed and not rendered, and the
3.5s/7.5s/11s recovery ladder is not wired into `SharedDayMap` — which is what
keeps M26 link 4 open rather than the rendering.
