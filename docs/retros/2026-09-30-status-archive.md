# STATUS archive — 2026-09-30

Four passages moved here verbatim from `docs/STATUS.md` by the retirement pass
in `docs/guidelines/retiring-a-rule.md`. `STATUS.md` was at 87% of its
30,000 B surface budget.

Why each went (the guideline's criteria):

1. **The header's account of the 2026-08-28 and 2026-09-11 cuts** — history of
   the document (criterion 2). The rule it carried stays, in one paragraph.
2. **"Retired from this list at M11's gate, 2026-08-28"** — history (2): three
   items that stopped being live a month ago.
3. **`## Next action`, whole** — stale (5): it named M28 as current four days
   after M28's gate closed, and M14 as next when M14 was already current. The
   rest was the placement history of closed milestones (M24, M12, M13, M22) and
   a restated list of M9's questions (4). What was still live is carried
   forward in `STATUS.md`'s rewritten *Next action*: the `KI-2026-09-25-q` carry,
   the two operator items, what waits on Mitchell, M9's gate and the open
   `KI-20260916-d`.
4. **`## Landed in the last week`** — stale (5): its newest entry was
   2026-09-11, and each line already named its durable record.

---

## 1. Header, as it was

**This file is live instruction only, and it is kept short on purpose.** It hit
1,779 lines on 2026-08-28, ~88% of it history, in the one file every session is
told to read first — so a first-read file became a file people skim. The rule
now: **at gate close, a phase's narrative moves to its milestone file or a retro
in the same commit, and this file keeps the pointer.** Everything that was here
before 2026-08-28 is in `docs/retros/2026-08-28-status-archive.md`, verbatim and
in order, with an index mapping each part to its durable home. Nothing was
deleted.

**It drifted back and was cut a second time, 2026-09-11** — to 1,418 lines, with
a `## Next action` section still naming M17 as the current work on the day M17's
gate closed. Length was the symptom; **the stale section was the defect**, and it
is the reason to distrust a long first-read file rather than merely resent it.
Lines 243-1188 are now `docs/retros/2026-09-11-status-archive.md`, same rule,
same verbatim treatment. If this file is over ~300 lines again, that is the
signal, not a style preference.

## 2. Retired from this list at M11's gate

**Retired from this list at M11's gate, 2026-08-28** — all three were on it and
none of them is live any more:

- **Migrations 0006-0010 are dispatched to production.** The gate's blocker, and
  the preview walk signed in and wrote as two users against the migrated schema,
  which is exactly the `recordSignIn` upsert into `users` this entry warned
  would throw. The standing rule is unchanged: merging does not apply a
  migration — dispatch it (`gh workflow run migrate-production.yml -f
  confirm=migrate`, from `main`) and say so in the PR body.
- **`/s/featured`'s dead end is gone — KI-61.** PR #79 replaced it with `/demo`;
  see the `/demo` paragraph above. Walked on the preview: 14 days, 68 stops,
  read-only, 2 conflicts rather than the pre-KI-60 twelve.
- **The CSP's last unwalked environment, the Vercel preview, is walked —
  KI-66.** The entry's "never executed by a browser" half was already closed
  earlier the same day by a local production-build walk; the preview was the
  named remainder, and M11's gate covered it — as did a cloud session on
  2026-08-29, independently, finding the same violation. One preview-only
  behaviour is still worth knowing before it is mistaken for a defect: a
  Deployment Protection re-challenge of an in-flight XHR reaches the app as a
  bare "Failed to fetch". The other one M11's gate recorded — the CSP blocking
  Vercel's feedback script on every preview page — was **not** "no app impact",
  and is fixed rather than documented; see the next section.

## 3. Next action, as it was

**M28 is the current milestone** (placed 2026-09-25). #238 is merged; what is
left is #239 and the gate's retro. One open question for Mitchell from the
preview walk: the `Pending` badge uses the same amber as the `Meal` tag.

**M14 is next** (M24's gate closed 2026-09-25, 11 of 11).
Its code is merged; what is left is the five boxes listed under *MERGED
2026-09-24* above, each of which needs Mitchell. The **route-map block** M14
parked until travel legs existed is now unblocked: a transit stop carries
`mode` and `endLocation`, and `routeLegs` in `mapRailData.ts` draws them.

**Carried out of M24, not gating M14:** `KI-2026-09-25-q`. About a dozen
surfaces read `activity.location.city` directly, including the M14 ones this
section used to list (`placeOfDay`, weather, `select.ts`). Each still reads a
travel leg's origin by default. The KI's first step adds one activity-level
helper with no behaviour change. The PR that resolves it files the second step:
a start-vs-end decision per surface.

**Two operator items are open:** the production content re-import M12's gate
close owes (three corrected country codes), and, from M27,
`LOCATIONIQ_API_KEY` on Vercel (Production and Preview) — the Playbook pin
backfill does nothing without it.

*Older, kept for the record:* **M24 was the current milestone** (M12's gate
closed 2026-09-23). It shipped 2026-09-25 as four stacked PRs; its retro is at
the end of `docs/milestones/M24-travel-legs.md`.

*Older, kept for the record:* **M12 was the current milestone** (M27's gate
closed 2026-09-23); its backend (#206) and UI (#212) are merged and its retro is
at the end of its milestone file.

*Older, kept for the record:* **M13 was the current milestone** (M26's gate closed 2026-09-21, 22 of 22). Read
`docs/milestones/M13-collaboration.md` before planning anything. M21's and
M22's gates closed 2026-09-19 on Mitchell's attestation — nothing of either is
owed.

**The prerequisite that used to stand here is DONE — 2026-09-21.** The
activity-field descriptor refactor, `KI-20260905-o`, ran as its own piece of
work at Mitchell's request rather than inside M13. Three milestones each add a
field to an activity (M13 link 5's `who`, M24's `mode`/`endLocation`, M19 link
1's cost kind), and ~21 non-test files hand-enumerated those fields with
nothing going red when one was missed. Now `ActivitySnapshot` declares the set
once, `ActivityState` is inferred from it, and `FIELD_EQUAL` in `equality.ts`
turns a ninth field into a compile error at every site — proven by adding one
and reading the errors. The entry is in `resolved/`; M13's gate box is ticked.

**Read this before writing link 5.** The read model `ActivityView` is
**deliberately not derived** from the snapshot. Deriving it carried write-path
length bounds onto a model that parses `trip_details.doc` straight off jsonb,
where a violating stored value would 500 the board rather than fail a write —
the #71 shape one field later. A key-parity assertion in `contracts/detail.ts`
keeps the compile-forcing instead, and it is weaker in exactly one way: it
forces the KEY to exist, not that its type matches. So adding `who` will break
the build until you add it to `ActivityView` too, and nothing will check that
you gave it the right type there.

**A second thing landed with it, and it is a behaviour change worth knowing
about**: a stop whose `kind` is `transit` is no longer a member of an
`impossible-geography` pair. Mitchell's case was a Lisbon→Porto train flagged
against its own destination at ~273 km. This is KI-60's explicitly rejected
weaker variant, added *alongside* the rule that replaced it rather than instead
of it; KI-60's entry now records that. The cost: a mistyped coordinate on a
transit stop is no longer caught by any rule.

**M22's last gate box closed 2026-09-19 on Mitchell's attestation**, but the
problem that blocked an agent from walking it is still open, and the next
tier-gated box on a preview will meet it: an account that can hold `api.tokens`
**on a preview**, which `KI-20260916-d` says is blocked by **`ADMIN_USER_IDS`** — injected at build, and
supplied by `playwright.config.ts` only to the local e2e server, so
`POST /api/admin/grants` answers 404 on a preview.

**That variable is bound to preview and production, and was created 2026-09-14
— two days BEFORE the walk that got the 404.** So the entry's fix sketch ("set
it in Preview and redeploy") describes a state that already held, and the cause
is more likely its **value**: `ADMIN_USER_IDS` takes `users.id` verbatim and
fails closed, and a dev-login operator's id is `dev-<username>`, not a Google
one. **Hypothesis, not finding** — the value is encrypted and was not read.
**The next step is a read**: check whether Preview's value contains the `dev-`
id `e2e/adminBootstrap.ts` grants through.

**Do not repeat the mistake this paragraph used to make.** Until 2026-09-19 this
line, `TODO.md` and two other places all said the blocker was
`API_TOKEN_PEPPER`. It is not, and never was: that variable is set on **all
three** Vercel targets, and `KI-20260916-d` does not mention it. The wrong name
survived in three status files because each copy read as confirmation of the
others, while the KI — the one document with the fact in it — went unread. When
these files and a known-issue entry disagree, **the entry is the one that was
written by somebody looking at the failure.**

*(This section has gone stale three times — it named M17 on the day M17's gate
closed, M9 on the day M20 was already built and merged, and M21 as unbuilt for
four days after all four of its phases merged. Read it with suspicion and check
it against `docs/milestones/README.md`'s Current milestone line, which is the
single source of truth.)*

**Two things are waiting rather than blocked, and both are Mitchell's.** Whether to flip
`ai-live` now that its precondition is met (above, with what it would expose), and whether
the three open questions M9 Phase 0 raised get answered before M21 prices anything — the
second of them, *which quota window a sold ceiling binds*, is the one M21 pays for if it is
left: it is implemented per-day and stated in no contract.

**M9's three real pieces of work are BUILT, and what is left of it is its gate.** Grounding,
conversation durability and the eval/replay harness all landed 2026-09-16 and relanded as
#188 — the section above carries it. What the gate still wants is what a build cannot
supply: a live model call, the Rochester re-run resting on one, and the browser walks. *(An
earlier version of this paragraph said "M9 stays paused behind M21" and listed all three as
unchanged. It had been wrong for two days.)*

**Phase 0 raised three questions that are Mitchell's, not a build's.** None blocks anything
current, and the second is the one that costs if it is left: whether the usage row carries a
`planVersionRef`; **which quota window a *sold* ceiling binds** (implemented per-day, stated
nowhere — M21 pays for this if it is not settled); whether the tier map is a Vercel Flag or an
env var.

## 4. Landed in the last week, as it was

Compressed on 2026-08-28 and again on 2026-09-11. Each line names the durable
record; the long-form narrative is in `docs/retros/2026-08-28-status-archive.md`
and `docs/retros/2026-09-11-status-archive.md`.

- **The assistant became a kernel, 2026-09-11.** M9 Phase 0, `bbc5bdb` (#162) and
  `845fc48` (#163). ADR-043 and `docs/milestones/M9-ai-planning-partner.md`'s
  Phase 0 section carry it; KI-2026-09-05-t and KI-22 are resolved.
- **M17's gate closed 2026-09-11**, nine days after the code shipped — the retro
  on *that* gap is in `docs/milestones/M17-account-customization.md`, and it is
  the more useful half of the entry.

- **A binding operating contract for dispatched subagents, 2026-08-28.**
  `.claude/protocol/` — lifecycle, three exit states, a two-strike handback
  rule, a run-scoped board and a mechanically checked report shape, enforced by
  four fail-open hooks. `ADAPTER.md` and `adapter.json` hold every
  travel-collab-specific fact and a test enforces that the other three files
  name nothing about this repo. Start a run with `/dispatch`. Design:
  `docs/specs/2026-08-28-subagent-operating-contract-design.md`. Known defects
  consciously left: KI-62, KI-63.
- **A travel day is no longer a false conflict, 2026-08-28 — KI-60.** The Japan
  demo went from 12 conflicts to 2 with no fixture change: `detectConflicts`
  compared every same-day located pair against a flat 150km and never read
  `kind`, so all ten `impossible-geography` warnings sat on the two days the
  trip relocates, each with the day's own shinkansen scheduled *between* the two
  stops. The rule now excuses a distance a transit stop crosses **in time**, on
  time order rather than stored order, and never excuses an untimed stop. Full
  reasoning, including the weaker rule that was rejected with evidence:
  `docs/known-issues/` KI-60.
- **One canonical Japan fixture, 2026-08-28 — ADR-030 (PR #74).**
  `@tc/fixtures` owns the 14-day/68-stop trip; the seed script, the preview
  branch's demo reset and `@tc/factories` all call the same commands, and
  `src/lib/japanTripImporter.ts` is deleted. The two copies that existed were
  identical by luck, and where they differed was live on preview: the reset
  produced a trip with **zero tags** the day before M18's tag chips shipped, and
  coordinates were 72/72 local against 51/72 preview with six wrong venues.
  `pnpm seed:verify` is the thing that keeps it true. Procedure for new
  features: `docs/guidelines/fixtures-and-seed-data.md`. Filed rather than
  fixed: KI-57, KI-58, KI-59.
- **M18's contract PR, 2026-08-27 (PR #63).** See "Where the work is right now".
  The trap worth remembering: `equality.ts`, `diff.ts`, `hydrate.ts` and
  `detail.ts` each hand-enumerate activity fields, so adding a contract field
  without touching all four compiles cleanly and is wrong at runtime — and
  because `decide.ts` gates `UpdateActivity` on `okUnlessNoOp`, a kind-only
  update was rejected as a no-op until equality learned the field. The shared
  property generator needed both fields too, or the diff property test would
  have kept passing while never generating either. The project review found the
  same class again in `Location.city`/`countryCode` (KI-54, since resolved), and
  §6.1's descriptor refactor is the standing fix.
- **M10's Wave-2 gate closed 2026-08-27, and M15's closed 2026-08-26 (PR #56).**
  Evidence, retros and the rules promoted out of the deleted phase plans:
  `docs/milestones/M10-visual-craft.md`, `docs/milestones/M15-front-door.md`.
- **Two full reviews, 2026-08-28.** `docs/reviews/2026-08-28-project-review.md`
  (seven dimensions, six parallel agents) and
  `docs/reviews/2026-08-28-m11-pr71-review.md`. Both are being worked through on
  the current branch; read the remediation plan for what is in scope and what
  was deferred with a reason.
