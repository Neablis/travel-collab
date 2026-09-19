### KI-2026-09-14-c — building a screen from the design has no route→artboard path, and no step that separates this milestone's half from a later one's

- **Severity:** rework, reliably. Building one screen (the M20 operator console) against a design cost four review rounds and three wrong builds, and every one of the three was caught by a person or a guard rather than by the process. Nothing shipped wrong; the cost is entirely in cycles and in Mitchell re-reporting the same screen.
- **Area:** `.design-sync/handoff/` (`SPEC.md`, `README.md`, `design/*.dc.html`) and whatever builds from it — `docs/guidelines/` has no page for this, which is the gap. Seen on `apps/web/src/app/admin/**`, PR #174.

- **What is wrong:** five separate things, each cheap on its own and expensive together.

  1. **There is no index from a route to its artboard.** `handoff/README.md`'s table lists design FILES and what each is for; it does not say which artboard draws `/admin`. Finding the operator console meant `grep -n "Operator console"` against a 675 KB `.dc.html` and reading around line 2147. That works once you think to do it, and the whole failure below is that nobody thinks to do it.
  2. **`SPEC.md` is ordered by date, not by section number.** §18 begins at line 184 and §17 at line 744. A reader who greps `§17` and reads forward from the first hit lands in the wrong section, and a reader who assumes the file is ordered gives up on a section that is present.
  3. **An artboard draws several milestones at once and says nothing about which is which.** The console artboard shows a four-number strip, `Pays` and `State` columns, a red "underwater" row highlight, two filter chips and per-tier MRR and margin — **all M21 link 7's**, none of it labelled. The only place the split is written down is M20 link 7's own split note, in a different file, which says in as many words: *"An implementer working from the finished screen will build the strip inside M20 and break the split in the direction `DRIFT.md` §2c only warns about in reverse."* That prediction is accurate and was not enough to prevent it.
  4. **The design's vocabulary carries concepts the current milestone cannot compute.** Copying a panel's title copied the idea of an account being "underwater", which is a comparison against income that M20 has no income for. `admin.console.test.ts` bans that word and refused the file — but only after a component, its copy and its tests were written around it.
  5. **A design's own ids collide with domain enums.** The artboard's filter set (`all / paying / granted / free / past_due / under`) became a `FilterId` union, and `case "free":` tripped `planVersions.fourthPlan.test.ts`, which walks every source file for a comparison against a plan id (ADR-045 rule 4). The filter id and the plan id were different concepts wearing the same string.

- **How it came to light:** Mitchell left four comments on the #174 preview — the grant form stacking, a list that should be a table, grants belonging in a modal, and *"We are missing this ui all together"*. Each was answered from his sentence alone, because the two screenshots he attached could not be fetched (`vercel.live` is denied by the cloud session's egress proxy, and the Vercel MCP will not mint a shareable URL for an attachment). Three rounds were spent reporting that block. **The screenshots were photographs of a design committed to this repository**, and reading the artboard — which took one `grep` — immediately produced the four missing pieces of the accounts panel and both missing lower panels. Then, building from it, guard (4) and guard (5) each refused a commit in turn.

  Two smaller traps from the same build, worth recording because they are the same species — a design describes a rendered result, and a primitive's defaults decide whether copying its structure reproduces it:

  - The grant form's controls were in a `flex-wrap` row exactly as drawn, and rendered one per line, because `Input` is `w-full` and a `w-full` flex item takes a 100% basis. **The markup said row and the widths said column.** Invisible in either file alone; obvious in a browser, which is where Mitchell found it.
  - The e2e test written to prove that fix asserted the controls shared a top edge. When the form moved into a dialog two commits later, that assertion would have **kept passing while testing nothing** — a geometry test outlives the layout it describes and then reads as coverage.

- **Why not fixed there:** the fix is a guideline plus two small mechanical aids, and this branch is a milestone build already carrying a lint-wall change. Writing the guideline mid-build would also have meant writing it from the middle of the mistake rather than from the end of it.

- **Scope:**

  1. **`docs/guidelines/building-from-the-design.md`**, short, with the order of operations that would have prevented all five: find the artboard (below) → read `SPEC.md`'s prose for the same screen → **diff it against the milestone link that owns the screen and write down what is out of scope before writing any code** → run the surface's invariant sweep (`admin.console.test.ts` and its equivalents) **before** building, so banned vocabulary fails in seconds rather than after a component is named for it → then build.
  2. **A route→artboard index** in `handoff/README.md`: one table, route to artboard heading to `SPEC.md` section. Ten lines, and it removes step one's guesswork permanently. Cheap enough that the absence is the only reason it has not existed.
  3. **A check that `SPEC.md`'s sections are findable** — either sort them, or (better, since the file is append-by-date on purpose) generate a section index at the top. A test that the index matches the headings keeps it true.
  4. **A note in the same guideline that design ids are not domain ids**: a filter, tab or chip id taken from an artboard's label set gets a name that says what the group means (`entitled` / `unentitled`), never one that spells a `PlanId`, an `Entitlement` or any other enum member. `fourthPlan.test.ts` already enforces this for plans; the guideline is what stops it being rediscovered per surface.
  5. **And one line that is not about designs at all**: assert what a person can do, not where a box is. The one-row geometry test is the concrete example — `docs/guidelines/testing.md` can take it as a worked case of a test that survives the thing it tests.

- **What is deliberately NOT in scope:** fetching the preview attachments. The egress denial is correct behaviour for a cloud session, and the right answer was never "get the image" — it was "read the design the image is a photograph of". A guideline that says so is worth more than a proxy rule.

- **A sixth gap, found the same day and by the same route:** a milestone's exit gate can be written entirely from the server's behaviour and never notice that a SURFACE is missing. M20's 29 boxes covered every entitlement rule, the resolver, the ledger and the admin console — and not one required the account sheet the design draws, so the milestone could have closed green with every entitlement it built invisible to the person holding it, and with link 8's stated purpose (*"gives an account a way to mint its own codes"*) unmet by a UI that never called the endpoint built for it. Mitchell: *"the exit gates are incorrect if it's in the designs but wasn't included in the gates."* Three boxes were added on 2026-09-14; the generalisation belongs in the guideline below — **when a milestone owns a surface in the design, the gate needs a box a person could fail by looking at the screen**, not only boxes a test can pass against the server.

- **Fix:** M26 link 0 (the preflight), 2026-09-19. All six scope items landed together:

  1. **`docs/guidelines/building-from-the-design.md`** — the five-step order of
     operations, with step 3 ("diff it against the milestone link that owns the
     screen and write down what is out of scope **before writing any code**")
     as its own step rather than a line of advice.
  2. **The route→artboard index** is in `.design-sync/handoff/README.md`, and it
     is **generated rather than hand-written** (`scripts/route-artboard-index.mjs`).
     The KI costed this at "ten lines"; a hand-written table would have been
     stale the next time the design side rewrote the file in place, which they
     do every pass. `scripts/__tests__/route-artboard-index.test.mjs` fails when
     a gate is renamed out of the design file, when a line number drifts, when a
     cited `SPEC.md` section does not exist, or when the app grows a route
     nobody has decided an artboard for. It also records the most useful thing
     the survey found: `/demo` and `/s/[token]` have **no artboard of their
     own on purpose** (SPEC §27 — read-only is a mode over the trip surface),
     so nobody goes looking for one and invents it.
  3. **`SPEC.md` now opens with a generated section index**
     (`scripts/spec-section-index.mjs`), numerically ordered, with the line
     number of each heading. The file stays append-by-date and is still never
     renumbered. `scripts/__tests__/spec-section-index.test.mjs` follows every
     line number to its heading, and asserts the file really is out of order —
     so if the design side ever does sort it, the index is recognised as dead
     weight rather than quietly maintained.
  4. **Design ids are not domain ids** is a section of the guideline, with the
     `all / paying / granted / free / past_due / under` case as the worked
     example and `planVersions.fourthPlan.test.ts` named as the wall.
  5. **The geometry-test line landed in `docs/guidelines/testing.md` §2** as a
     fourth question ("will this still be about the same thing after the layout
     changes?"), with the one-row assertion as the worked case.
  6. **The sixth gap** — a gate written from the server that cannot see a
     missing surface — is a section of the guideline, and M26's own gates mark
     those boxes `**[walk]**`.

  One thing not in the KI's scope was added by the M26 survey and belongs here
  because it is the same species: the colour wall was blind to an undefined
  token NAME (`KI-2026-09-19-g`). Extending it found two live defects on its
  first run — `bg-canvas` on the shared-trip screen (three occurrences, a page
  ground that rendered as nothing) and `ring-primary` on the selected-widget
  ring — neither of which any other layer could see.

- **First noted:** 2026-09-14, building M20's operator console on PR #174.
  **Resolved:** 2026-09-19, M26 link 0.
