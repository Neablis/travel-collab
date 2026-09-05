# Overnight project review — 2026-09-05

**Status: COMPLETE 09:00 PT 2026-09-05.** Every finding independently verified. This file is
the plan and the live tracker; it is updated as each stream finishes. The
findings it produces live one-per-file under `findings/`, written so a fixer
agent can act on one without re-deriving it.

Requested by Mitchell 2026-09-04 22:15 PT: *"the big pass"* — track progress,
use research subagents, and leave a list of found issues documented well
enough for another agent to fix.

Tree under review: branch `claude/project-overnight-review-nxjj1y` at the
commit this file is committed in, which is `main` (`947646f` + #142) plus this
review's own prose. No code is changed by this review.

## Scope — the seven questions

| # | Stream | Question | Where to look first |
|---|---|---|---|
| A | Security | Are invites, shared trips, members, and the shared notebook / playbook library safe? Authz on every route, token handling, CSP, dev-only routes, AI spend. | `apps/web/src/server/access/**`, `accessPolicy.ts`, `apps/web/src/app/api/**`, `middleware.ts`, `auth*.ts`, `SECURITY.md`, KI-066 |
| B | Notebook + widget AST | Is the widget framework a framework — clean, extensible, common-sense rules for the next fifty widgets — or a hand-built set of twelve? | `packages/pages/**`, `packages/contracts/src/pageDoc.ts`, `pages.ts`, `apps/web/src/components/pages/**`, `server/pages.ts`, `server/ai/pageTools.ts`, ADR-035…039, `docs/specs/2026-09-0{3,4}-*.md` |
| C | Versioning, history, migration | Will the first major change or pivot break existing trips and notebooks? Event versioning, `PageDoc` migrations, projection rebuild, Drizzle migrations, clone/share replay, kept-day snapshots. | `packages/contracts/src/{events,history,pageDoc}.ts`, `server/{eventStore,projections,history,cloneTrip}.ts`, `access/sharedView.ts`, `savedDays.ts`, `drizzle/**`, ADR-003/005/016/027/028/036/038/040 |
| D | Infra, DB, Vercel, review loop | Are the dev / DB / deploy decisions right, and are we using the tools we have (Vercel, GitHub, CodeRabbit, Neon, Sentry, flags) well? | `.github/**`, `apps/web/scripts/**`, `scripts/**`, `docs/guidelines/{environments-and-deploys,ci-cost-and-capacity,quality-enforcement}.md`, `.coderabbit.yaml`, `next.config.*`, `sentry.*`, `.claude/**` |
| E | Maintainability & patterns | Which coding patterns are working, and which cause repeat issues? Mine the KI register and retros for recurrence classes; read the largest files. | `apps/web/src/components/**` (esp. `TripBoardScreen`, lenses, `TripProvider`, `optimistic.ts`), `lib/apiClient.ts`, `docs/known-issues/**`, `docs/retros/**` |
| F | Simplifiable code | Where is code more complicated than its job? | `server/ai/**` (esp. `handleAskRequest.ts`), `server/{quota,admission,savedDays,playbooks}.ts`, `packages/domain/**`, duplicated helpers across `components/**` |
| G | Broken functionality | What is broken now and uncaught? Run every lane that can run here, then hunt in code the lanes do not reach. | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:int` (Postgres :5433), `pnpm --filter web test:e2e:ci-like`; then untested routes and UI paths |

## Method

1. **One research subagent per stream**, all dispatched in parallel at 00:30 PT,
   each with the brief in `briefs/` and a hard rule: **cite `file:line` for every
   claim, and separate CONFIRMED (path traced end to end) from PLAUSIBLE
   (mechanism seen, trigger not proven).** Read-only; no code changes.
2. **A verification wave** re-checks every finding marked HIGH or CONFIRMED
   against the tree before it is written up, independently of the agent that
   found it. Anything that does not survive is dropped or downgraded, and the
   report says so.
3. **Write-up.** Each surviving finding becomes `findings/F-<stream><nn>-<slug>.md`
   in the template below; the report body (this README, §Findings) indexes them
   by severity and the executive summary names the ten to act on first.
4. **Known-issues cross-check.** Before filing, `grep -rl <symptom> docs/known-issues/`.
   A finding that already has a KI links to it rather than duplicating it
   (README rule: one defect, one entry). New correctness defects are **not**
   filed as KIs by this review — the register is for things knowingly left
   unfixed, and the point of this list is that they get fixed — but the
   template carries every KI field so filing one is a `git mv` if Mitchell
   decides to defer.

## Finding template (`findings/F-*.md`)

```markdown
# F-A01 — <one line, symptom terms>

- **Stream:** A Security · **Severity:** HIGH | MEDIUM | LOW · **Confidence:** CONFIRMED | PLAUSIBLE
- **Area:** files a fixer opens first, with lines
- **What is wrong:** the observable problem, then the mechanism, with `file:line` cites
- **How to reproduce / how it was verified:** the exact steps or the code path traced
- **Suggested fix:** concrete enough to start from; name the alternative if there is a real choice
- **Scope of the fix:** files touched, whether contracts change (→ CHANGELOG entry), whether a migration is needed, expected check subset
- **Test that should exist:** what would have caught it, at which layer (`docs/guidelines/testing.md`)
- **Cross-reference:** KIs, ADRs, milestones, prior review sections
- **Do not:** anything a fixer might reasonably do that would be wrong here
```

## Tracker

Updated live. Times are PT.

| Step | State | Notes |
|---|---|---|
| Orientation read (AGENTS, STATUS, layout, prior reviews) | done 22:40 | This file |
| Briefs written for A–G | done 22:55 | `briefs/` |
| Wake scheduled 00:30 | done 22:56 | send_later → 07:30 UTC |
| Streams A–G dispatched | 00:31 | seven general-purpose agents, parallel |
| A Security | done 00:41 | 7 findings (6 CONFIRMED), 37-route authz table, 08-28 items: 7 fixed, 2 still open |
| B Notebook / widget AST | done 00:41 | 9 findings (8 CONFIRMED), 3 recipes, 12 proposed rules |
| C Versioning / migration | done 00:40 | 7 findings (6 CONFIRMED), pivot-cost analysis, 13 verified-sound |
| D Infra / DB / Vercel / review loop | done 00:43 | 8 findings (6 CONFIRMED), 13 ranked recommendations, 08-28 items: 8 fixed, 2 still open |
| E Maintainability / patterns | done 00:39 | 9 findings (7 CONFIRMED), 7 recurrence classes, 12 verified-sound |
| F Simplifiable | done 00:44 | 12 findings (all CONFIRMED), /ask flow map, 13 deliberately-not |
| G Broken functionality (lanes + hunt) | done 08:40 | ALL LANES GREEN: typecheck, lint, unit, int 450/450, seed:verify 18/18, e2e ci-like 89/89, drizzle check. First agent killed by session limit during the browser walk |
| Verification wave | A–G done 09:00 | Session limit hit ~00:50 PT killed four verifiers + stream G mid-run; resumed 07:31 PT. Every stream had 1–4 cites pointing at wrong lines; all corrected in findings/. One escalation (F-B09), four downgrades, one drop (F09 truncators) |
| Findings written | done 08:45 — 56 files | |
| Executive summary | done 08:45 | |
| Committed + pushed | continuous; final at 08:45 | |

## Findings

Fifty-six finding files under `findings/`, one per issue, each carrying severity, confidence after independent verification, `file:line` cites (corrected where the finder's were wrong), reproduction, suggested fix, fix scope, the test that should exist, and a "do not" line. Ids are `F-<stream><nn>`.

### Severity index

| Id | Severity | Confidence | One line | Fix size |
|---|---|---|---|---|
| [F-A01](findings/F-A01-demo-branch-makes-viewer-routes-anonymous.md) | MEDIUM | CONFIRMED | Demo-trip branch in `requireTripAccess` answers before `auth()`; anonymous `POST /api/saved-days` inserts unbounded orphan rows | S |
| [F-A07](findings/F-A07-bearer-tokens-reach-sentry-unscrubbed.md) | MEDIUM | CONFIRMED | Share/invite bearer tokens reach Sentry on every traced request; no `beforeSend` anywhere (merged with D02) | S |
| [F-B01](findings/F-B01-server-accepts-any-widget-name-and-params.md) | MEDIUM | CONFIRMED | Page write path stores any widget name/params; `attribute` allow-list enforced only in the browser | S |
| [F-B09](findings/F-B09-storing-parsed-doc-entombs-unknown-nodes.md) | MEDIUM | CONFIRMED (reproduced) | Server stores the *parsed* PageDoc, so an unknown node from a newer client is entombed as `unknown` — defeats ADR-038 decision 3 during a rolling deploy | S |
| [F-B02](findings/F-B02-narrow-is-not-total-over-filterdimension.md) | MEDIUM (latent) | CONFIRMED | `narrow` and `optionsFor` are not total over `FilterDimension`; a new dimension is accepted, rendered and silently ignored | S |
| [F-C01](findings/F-C01-no-event-upcaster-layer.md) | MEDIUM | CONFIRMED | No event upcaster exists; the discriminated union makes the guideline's prescribed procedure impossible as written | M |
| [F-C02](findings/F-C02-no-operator-projection-rebuild.md) | MEDIUM | CONFIRMED | No operator path to rebuild projections; the only rebuild is all-or-nothing and names no stream on failure | M |
| [F-C03](findings/F-C03-undispatched-production-migration-undetectable.md) | MEDIUM | CONFIRMED | Merged-but-undispatched production migration is undetectable; PR template has no migration line (merged with D01) | S |
| [F-C04](findings/F-C04-savedstop-has-no-version-or-defaults.md) | MEDIUM | CONFIRMED | Kept days carry no version and `SavedStop` has no defaults; first required field hides every Playbook | S |
| [F-D03](findings/F-D03-drizzle-migrator-skips-older-migrations.md) | MEDIUM | CONFIRMED | Drizzle applies only migrations newer than the last applied; two PRs in flight can silently skip one — in production too | S |
| [F-G01](findings/F-G01-non-uuid-route-params-500.md) | LOW-MED | CONFIRMED (live ×3) | Any non-UUID route param reaches Postgres; ~12 routes 500 instead of 404 and the board renders "Internal Server Error" | S |
| [F-G02](findings/F-G02-live-geocode-accepts-wrong-venue-in-right-box.md) | MEDIUM | CONFIRMED | Live geocode enrichment accepts a wrong venue inside the right box, renames the stop and marks it `verified`; the check for this exists and is unused | S |
| [F-E01](findings/F-E01-activity-fields-hand-enumerated.md) | MEDIUM | CONFIRMED | Activity fields hand-enumerated in ~21 files; the 2026-08-28 descriptor fix was scheduled, never built, never filed (= F01) | M |
| [F-E02](findings/F-E02-optimistic-queue-needs-interleaving-property.md) | MEDIUM | CONFIRMED | Six KIs of silent loss on the optimistic queue fixed as lines; no interleaving property test | M |
| [F-E03](findings/F-E03-api-client-is-35-hand-mirrored-wrappers.md) | MEDIUM | CONFIRMED | "Typed API client" is 35 hand-mirrored wrappers + a second client + 3 raw fetches; MSW mocks are not generated | M |
| [F-E07](findings/F-E07-ask-handler-is-one-455-line-function.md) | MEDIUM | CONFIRMED | `handleAskRequest()` is one 455-line function; ~15 open AI KIs share KI-9's agreed fix | M |
| [F-D06](findings/F-D06-dependency-skew-and-open-dependabot-alerts.md) | LOW-MED | CONFIRMED | drizzle-kit 0.28 vs orm 0.45; `next-auth` floats on a beta; **17 open Dependabot alerts (9 high) on `main`** | S + human |
| [F-E04](findings/F-E04-five-routes-500-on-malformed-json.md) | LOW-MED | CONFIRMED | Five routes 500 on malformed JSON, three 400; no shared body reader | S |
| [F-E06](findings/F-E06-two-walls-have-no-self-test-packages-unlinted.md) | LOW-MED | CONFIRMED | Two lint walls have no self-test; `packages/*` unlinted (KI-2026-09-02-c) | S |
| [F-A02](findings/F-A02-page-content-unbounded-on-write.md) | LOW | CONFIRMED | Page title/content unbounded on write (L5 from 08-28, still open) | S |
| [F-A03](findings/F-A03-sentry-example-route-ships-to-production.md) | LOW | CONFIRMED | Sentry wizard example route: unauthenticated, throws on every hit | XS |
| [F-A04](findings/F-A04-member-emails-sent-to-any-viewer.md) | LOW | CONFIRMED | Every member's email sent to any viewer; nothing renders it | S |
| [F-A05](findings/F-A05-csrf-rests-on-samesite-lax-alone.md) | LOW | CONFIRMED | CSRF rests on `SameSite=Lax` default alone (L6 from 08-28, still open) | S |
| [F-A06](findings/F-A06-removed-member-spent-invite-says-success.md) | LOW | CONFIRMED | Removed member's spent invite link answers "success" with a role they lack | S |
| [F-B03](findings/F-B03-serializepagenode-has-no-exhaustive-default.md) | LOW (latent) | CONFIRMED | `serializePageNode` has no `never` default; a future node writes as `null` and locks the page | XS |
| [F-B04](findings/F-B04-notebook-never-refreshes-trip-detail.md) | LOW | CONFIRMED | Open notebook never refreshes trip detail (nor does the board — app-wide model) | M |
| [F-B05](findings/F-B05-count-of-day-city-has-no-preset.md) | LOW | CONFIRMED | `count{of: day\|city}` reachable only by the AI; no preset | XS |
| [F-B06](findings/F-B06-dead-widget-vocabulary-reads-as-seams.md) | LOW | CONFIRMED | Dead widget vocabulary (`days`/`trip` inputs, `ItemScope`, `resolveMacro`, `MacroKind`) | S |
| [F-B07](findings/F-B07-resolver-property-test-uses-retired-vocabulary.md) | LOW | CONFIRMED | Resolver property test generates retired v1 params; `unbound` path never reached | XS |
| [F-B08](findings/F-B08-prompt-hand-lists-non-filter-params.md) | LOW | CONFIRMED | Prompt hand-lists non-filter params beside the derived catalogue | XS |
| [F-C06](findings/F-C06-golden-rebuild-misses-activityupdated.md) | LOW (nit) | CONFIRMED | No rebuild suite issues `UpdateActivity`; jsonb round-trip of that payload unproven | XS |
| [F-C07](findings/F-C07-migration-journal-unchecked-forward-only-undocumented.md) | LOW | CONFIRMED | Journal shape unchecked in CI; forward-only undocumented | S |
| [F-D04](findings/F-D04-fresh-clone-recipe-fails-twice.md) | LOW | CONFIRMED | README fresh-clone recipe fails twice (`db:reseed` does not migrate; seed needs the server) | XS |
| [F-D05](findings/F-D05-minimumreleaseageexclude-is-inert.md) | LOW | CONFIRMED | `minimumReleaseAgeExclude` is inert; the control it implies is off | XS |
| [F-D07](findings/F-D07-skills-lock-json-is-an-empty-stub.md) | LOW | CONFIRMED | `skills-lock.json` empty stub | XS |
| [F-D08](findings/F-D08-ci-header-argues-from-a-cap-that-no-longer-binds.md) | LOW | CONFIRMED | `ci.yml` header / `.coderabbit.yaml` argue from lapsed constraints | XS |
| [F-D09](findings/F-D09-review-loop-recommendations.md) | n/a | — | Thirteen ranked infra / review-loop recommendations, plus what is verified sound | — |
| [F-E05](findings/F-E05-gettripdetail-returns-unparsed-doc.md) | LOW (latent) | DOWNGRADED | `getTripDetail` returns an unparsed doc typed by a Drizzle cast; six raw callers, none reads a defaulted field today | S |
| [F-E08](findings/F-E08-guidelines-restate-and-contradict-agents.md) | LOW | CONFIRMED | `quality-enforcement.md` restates the DoD and now contradicts AGENTS.md's tiers | XS |
| [F-E09](findings/F-E09-design-wall-backlog-lives-in-128-disables.md) | LOW | CONFIRMED | 128 element-wall disables, 71 excusing geometry the rule cannot express | S |
| [F-F02](findings/F-F02-offeredtoolnamesfor-is-a-second-statement-of-tool-sets.md) | LOW | CONFIRMED | `offeredToolNamesFor` is a second statement of tool sets, tested against itself | XS |
| [F-F03](findings/F-F03-ask-handlers-duplicate-body-ritual.md) | LOW | CONFIRMED | Two AI handlers duplicate the body ritual verbatim (do with F-E04) | XS |
| [F-F04](findings/F-F04-two-single-caller-passthroughs-in-write-path.md) | LOW | CONFIRMED | Two single-caller pass-throughs, one dead parameter | XS |
| [F-F05](findings/F-F05-saved-day-row-parse-duplicated.md) | LOW | CONFIRMED | Saved-day row parse duplicated (home for F-C04's `v`) | XS |
| [F-F06](findings/F-F06-two-command-executors-share-five-steps.md) | LOW | CONFIRMED | Two command executors share five of seven steps verbatim | S |
| [F-F07](findings/F-F07-sleep-wall-redundant-with-eslint.md) | LOW | CONFIRMED (narrowed) | Sleep wall redundant with ESLint at error since 2026-09-02 (it *does* have a test) | S |
| [F-F08](findings/F-F08-checkadmission-dead-and-header-lies.md) | LOW | CONFIRMED | `checkAdmission` dead; gate module's header describes a check that does not exist | XS |
| [F-F09](findings/F-F09-small-duplicates-in-server-ai.md) | LOW | CONFIRMED (partial) | `usageOf`/`modelIdOf` duplicated (truncators are *not* — dropped) | XS |
| [F-F10](findings/F-F10-queryable-declared-four-times.md) | LOW | CONFIRMED | `Queryable` declared four times | XS |
| [F-F11](findings/F-F11-accountmenufromsession-dead-and-comments-stale.md) | LOW | CONFIRMED | `AccountMenuFromSession` dead; three comments stale | XS |
| [F-F12](findings/F-F12-geocodenamematch-lives-in-ai-but-only-seed-uses-it.md) | LOW | CONFIRMED | `geocodeNameMatch` under `server/ai` but only the seed uses it (see G for whether it *should* be used live) | XS |
| [F-G03](findings/F-G03-home-page-load-has-no-failure-path.md) | LOW | CONFIRMED | Home page `load()` handles only 401; a 500 leaves the page silently empty | XS |
| [F-G04](findings/F-G04-adr-008-says-whole-yen-code-uses-hundredths.md) | LOW | CONFIRMED (partly in ADR-008:74-78) | ADR-008 says whole yen; code uses hundredths; board and notebook disagree on JPY decimals | XS |
| [F-G05](findings/F-G05-profile-route-200-for-nonexistent-user.md) | LOW | DOWNGRADED | Profile 200 for unknown user is documented intent; dead branch + fabricated-looking name remain | XS |
| [F-G06](findings/F-G06-analytics-mount-unconditionally-off-vercel.md) | LOW | CONFIRMED (walk) | Analytics/SpeedInsights mount off-Vercel → 2 console errors on every page; hides real errors | XS |
| [F-C05](findings/F-C05-superseded-by-F-B09.md) | — | superseded | Folded into F-B09 | — |
| F-F01 | — | = F-E01 | Same finding from the simplification angle | — |

Fix size: XS < 30 lines · S one PR, one afternoon · M own PR with a contracts change or a design note.


## Executive summary — the ten things to act on first

Verification notes: every one of these was traced by the finding agent and re-traced by an independent verifier (F-G01 was reproduced live by both). Every stream had between one and four cites pointing at wrong lines in its first draft; all are corrected in `findings/`. Nothing in this list is a guess.

1. **Notebook writes bypass the AST's own safety rules (F-B09, F-B01).** The pages routes store the *parsed* document, so a node from a newer client is permanently reclassified as `unknown` — the rolling-deploy case ADR-038 decision 3 was designed for, defeated on the server. The same write path accepts any widget name and params, so the `attribute` allow-list is a browser convention. One insertion point fixes both: parse → registry check → `serializePageDoc(migratePageDoc(...))` → store. Half a day.
2. **Bearer tokens land in Sentry on every request (F-A07).** Share and invite tokens are the whole secret (ADR-026/027). The Referer side is hardened; the telemetry side has no `beforeSend` at all, and tracing samples at 100%. One `scrubUrl` in `sentry.shared.ts`.
3. **Production migrations have no detector, and Drizzle can skip one silently (F-C03, F-D03).** Manual dispatch was a deliberate 2026-08-27 decision; what is missing is a *detector* — a template line, a health check, a journal wall that compares against `main`. The migrator's "newer than last applied" rule means two migration PRs in flight can silently drop one, in production as well as preview. Whether 0012–0015 were ever dispatched is not recorded anywhere; **check that first.**
4. **The demo seam makes viewer routes anonymous, and one is an unbounded write (F-A01).** `requireTripAccess` answers the demo trip before `auth()`. `POST /api/saved-days` inserts orphan rows for anyone on the internet; the AI route already special-cases this by hand, which is the tell. Make the demo answer opt-in.
5. **"Will the first pivot break it?" — additive yes, representational no (F-C01, F-C02, F-C04).** Every schema change so far was additive-with-default and that path is solid. A non-additive change (money model, absolute instants) needs an upcaster layer that ADR-003 promised, three guidelines describe, and the discriminated union makes impossible as written; a per-stream rebuild an operator can run; and a version on kept days. Write the ADR before the pivot, not during.
6. **The widget framework is a framework for primitives and not yet for dimensions, shapes or data (F-B02, F-B03, F-B05).** Adding widget #13 is four files and every omission is red. Adding a filter dimension or a shape has two silent holes each (`narrow`, `optionsFor`, the CSS shape rule); adding a data source has no rule at all. Twelve proposed rules below; two mapped types and three `never` defaults close most of the holes.
7. **The activity-field descriptor was scheduled on 2026-08-28 and never built (F-E01).** Three incidents (KI-1, KI-54, M18's sheet), ~21 files, and it is in neither the KI register nor TODO. A compile-forced descriptor ends the class.
8. **The optimistic queue needs a property, not a seventh line-fix (F-E02).** KI-5 and KI-90 are open; four more were closed as lines and each opened the next window. One fast-check interleaving property would have caught all six.
9. **Client errors surface as 500s and Sentry faults, on both sides of the wire (F-G01, F-E04, F-E03, F-F03).** No route parameter is ever validated as a UUID, so a mistyped link 500s ~12 routes and the board prints "Internal Server Error" — measured live, stable. Five routes 500 on malformed JSON. Thirty-five fetch wrappers carry 35 identical catch blocks, a second client exists, and the mocks documented as "generated" are hand-written. A `uuidParam` check at the access seam, a `readBody` helper and a `fetch` lint are the whole fix.
10. **The AI's geocoder accepts the wrong venue and calls it verified (F-G02), and dependency hygiene has a human-shaped hole (F-D06).** The seed pipeline learned three times that a bounding box cannot reject a wrong venue in the right city and grew `placeNameVerdict`; the live request path never got the call, so it renames the stop after the wrong place and hides it from the "unverified" notice. Separately, GitHub reports 17 open Dependabot alerts (9 high) on `main`, untriaged in the repo.

**All test lanes are green** (typecheck, lint, unit, integration 450/450, `seed:verify` 18/18, production-build e2e 89/89, `drizzle-kit check`), and a 17-path browser walk found no app-originated console error. Everything above is something the lanes do not reach.

## Per-stream summaries

### A — Security

Thirty-seven routes walked; the route × authz table is in the stream report (`briefs/` has the method; the table itself is in F-A01's context and reproduced in the scratch report). Every route has an authz check except the Sentry example (F-A03). **Verified sound, and worth knowing:** AGENTS.md invariant 6c holds for every planning write (both command paths compute effective members inside the transaction; `MINIMUM_ROLE` is an exhaustive `Record`); actor forging is not expressible; invite tokens are 32-byte CSPRNG, single-use via conditional UPDATE, revocation removes membership in the same transaction, spent/revoked tokens disclose nothing, no log line carries a token; share links narrow through an explicit allow-list (`sharedView.ts`) with `Referrer-Policy: no-referrer`; saved days and playbooks are WHERE-scoped to owner-or-public and not-deleted, private/deleted/missing collapse to one 404, profiles carry no email; SQL is parameterised throughout; the admission gate is constant-time and fail-closed; dev login and demo reset are gated on `VERCEL_ENV` (both 2026-08-28 findings fixed); the JWT carries an `env` claim; CSP has `frame-ancestors 'none'`; AI spend controls are Postgres-backed and fail-closed (2026-08-28 H1 fixed); exactly one outbound `fetch` exists and it takes user text only as a query parameter. Of the 2026-08-28 security items, seven are fixed, L2 is KI-24, and L5/L6 are still open (F-A02, F-A05). Role semantics as coded: a viewer reads everything, duplicates, saves days, asks read-only; an editor runs every planning command including undo/redo/revert, CRUDs pages, creates/lists/revokes *any* share including the owner's, applies AI proposals; only the owner invites, removes members, deletes/restores; there is no ownership transfer and no leave-trip.

### B — Notebook and widget AST

**Verdict:** a framework for new primitives over the existing five entities and six dimensions (four code files; every omission except forgetting entirely is a red test), a framework with two silent holes each for a new filter dimension or shape (F-B02, and the CSS `[data-macro-shape]` rule plus `WidgetPicker`'s `FILTERS` list), and not yet a framework for a new data source (`WidgetContext` is a hand-shaped four-field struct; ~6 files, no rule). The AST side is stronger than the widget side: one exhaustiveness hole (F-B03) and one write-path defect (F-B09). **Verified sound:** one insert door and all five origins use it; illegal filters refused before shape; params schema derived from declared dimensions and tested for key *survival*, not just parse success; no stored preset — documents carry `(name, params)` only; the AST is closed per position with unknowns wrapped and serialised byte-identically in the browser; the vocabulary guard is derived from TipTap's own schema and covers `repeat`; `v` is derived from the migration chain, so "bumping v" literally means appending a migration; the chrome row is generated from declarations with no per-widget case; KI-2026-09-05-a and -c share one cause (the inline atom), -b is unrelated.

**Proposed rules for a `docs/guidelines/widgets.md`** (each is either what the code already enforces or what a finding above says it should):

1. A widget is `entity + filters + shape`, declared, and nothing else knows its name. No `switch(name)` in `apps/web`; dispatch is on `Rendered.kind` and `BlockPayload.kind`. If adding a widget touches a component, stop.
2. A widget knows `WidgetContext` (`trip?`, `page`, `user`, `globals`) and its parsed params. It does not know the DOM, colours, the reader beyond `user`, other widgets, the clock, or any fetch.
3. Filters are optional and absent means everything. Never default a dimension. `unbound` is only for `trip` and a ref aimed at something deleted.
4. Semantics live in `narrow`, once. A primitive never re-implements day/city/tag/kind/dates selection. A dimension `narrow` does not honour is not a dimension (F-B02).
5. Non-filter params (`of`, `field`) are chosen by presets, not controls. Every legal value must be reachable by at least one preset (F-B05).
6. Adding a primitive is one def, one `DEFS` entry, one preset, one golden. Anything more is a smell to report. Adding a preset is a row of data and never a migration.
7. Adding a dimension or a shape is a contract change: enum in `@tc/contracts`, CHANGELOG, the `Record<…>` maps go red, *and* `narrow` / `optionsFor` / the CSS shape rule — which do not, until F-B02 lands.
8. Every closed-union switch ends in `const exhaustive: never` — in `packages/*` too, because this repo does not set `noImplicitReturns` (F-B03).
9. Derive, never restate: node sets from the editor schema, tool enums from `MACRO_NAMES`, aliases from `WIDGET_NAME_MIGRATION`, prompt prose from the catalogue (F-B08).
10. Stored names are storage format. Renaming or removing a primitive is a `PAGE_DOC_MIGRATIONS` step with a golden; a preset rename is free.
11. Every write of a `PageDoc` re-parses, migrates, registry-checks and stamps `v` **on the server**, not only in the browser (F-B01, F-B09).
12. A sweep test is non-vacuous or it is not a test: a witness floor, or "seen equals catalogue" (F-B07).

### C — Versioning, history, migration

**Pivot cost, in one paragraph each.** *(a) Trips become multi-owner organisations:* cheap. ADR-003 kept membership out of the log and invariant 6 kept "the user" out of queries; the owner is minted in three places and the one trap is `diff.ts:13-14`'s precondition that members never differ. Needs F-C02 for the projection rebuild. *(b) A second time zone or a new money representation:* additive is a day of consumer work (41 files touch `timeWindow`, 29 touch `amountMinor`) with zero migrations — the proven M18 path. Non-additive is blocked on F-C01 (upcaster), F-C02 (rebuild), F-C04 (kept-day backfill); pinned shares keep working automatically because they replay; notebooks are unaffected because widgets store filters, not money. **Verified sound:** `seq` is per-stream, contiguous by construction, never deleted; undo/redo/revert are ordinary events and reducer-agnostic; pinned shares replay with today's reducer by design (ADR-027 chose this over snapshots); clone remaps ids and compensates a failed batch; `PageDoc` versioning is the strongest part of the repo (derived `v`, idempotent migrate-on-read, future refusal, hand-written goldens, write-back only on edit, stale-tab safety); adding a node type needs no migration; identity coupling is loose on purpose — no FK, no cascade, email is a label; `migrate-production.yml`'s guards are correct; `drizzle-kit check` passes.

### D — Infra, DB, Vercel, review loop

See F-D09 for the thirteen ranked recommendations and the verified-sound list. Of the 2026-08-28 infra items, eight are fixed and two remain: `tsc` runs three times per PR, and the PreToolUse guard against the wrong e2e lane was never built (only the prose was fixed). The CI-minutes constraint the workflow header argues from lapsed on 2026-08-31 when the repo went public; wall clock and signal are the constraints now. The Node version is unpinned across three environments (laptops 26, CI 22, Vercel 24 — KI-20260902).

### E — Maintainability and patterns

**Working well (keep doing):** walls with a memory — every ESLint block names its incident, and `reportUnusedDisableDirectives: "error"` makes both grandfathered backlogs shrink monotonically; parse-at-the-seam-once (`requireTripAccess`, `apiClient`'s `readJson`); enumerate-and-assert tests that fail when a *sibling* is added without registration (`apiClient.test.ts`, `presets.test.ts`); result types with `"error" in x` narrowing at every boundary; red-first as a tool (`pnpm redfirst`, `pnpm mutate`) and the file-per-KI scheme, both mechanisms that replaced prose that failed. **Causing repeat issues (each with its guard):** hand-enumerated field lists → compile-forced descriptor (F-E01); line-fixes on the optimistic queue → interleaving property (F-E02); routes mirrored by hand three times → `fetch` lint + `readBody` (F-E03/E04); typed-but-unparsed at the source → return parsed or `unknown` (F-E05); walls asserted, not demonstrated → fixture-must-fail tests (F-E06); model output consumed at N sites → KI-9's schema-required wrapper (F-E07); rules restated instead of pointed to → guidelines cite, never re-quote (F-E08). Open-KI census: 40 open, 17 correctness; 14–17 cite `server/ai`.

### F — Simplifiable

The `/ask` request flow is mapped step by step in the stream report (13 steps, one file each) — worth lifting into `docs/specs/2026-08-29-one-ai-route-design.md`. Line counts in `server/**` are roughly half comments recording incidents (`handleAskRequest.ts` 410 code / 583 comment); nothing here proposes deleting that record. **Deliberately not findings (complexity earning its keep):** `minimumRoleFor`'s re-check tripwire; `selectAiModel`'s three-way outcome (ADR-019); the `settled` promise that survives the serverless lifetime; `logAskAnalytics`'s triple try/catch on a raw abort listener; `ReadContextSchema`'s `z.custom` passthrough; `notDeleted` pasted into seven queries for grep-ability; the hand-rolled slash menu; `evolve.ts`'s `requireDay` throw (corrupt-stream totality). Two patterns worth a small PR: pure data helpers exported from `.tsx` (`DayChips.tsx`'s `chipModel`/`cityFor` imported by eight modules) belong in `lib/`; `lib/playbooks.ts` and `lib/cities.ts` both say "this belongs in `packages/contracts`" and neither is a KI or TODO line.

### G — Broken functionality (lanes + hunt)

**Every lane is green** on this tree: `pnpm typecheck`, `pnpm lint` (all five walls), `pnpm test` (fail 0), `pnpm test:int` (40 files, 450 tests), `pnpm seed:verify` (18), `pnpm --filter web test:e2e:ci-like` (89 passed, 2.1 min, teardown 63/63), `drizzle-kit check`. A 17-path browser walk against a local production build (desktop and phone; notebook editing with a `/cost` slash insert, invite accept, share view, playbooks) produced no `pageerror` and no app-originated console error. The only console noise was F-G06's two 404s per page and a `POST /monitoring` 403 that is the sandbox proxy refusing the Sentry tunnel host, not the app. The hunt then went where the lanes do not: **F-G01** is a live, stable 500 on any mistyped id in ~12 routes (no route param is ever validated as a UUID before it hits a uuid column — reproduced three times by two agents); **F-G02** is the seed pipeline's wrong-venue predicate never having been wired into the request path (KI-015's fix path). The verifier downgraded G04 (ADR-008 already concedes the 2-decimal display), G05 (the 200 for an unknown user is documented anti-enumeration intent) and G06 (noise only). **Verified sound:** every route awaits `params` under Next 16; `history/[seq]` range-guards; domain reducers are exhaustive by return type and never mutate input; `packages/pages` resolvers handle empty trip, no dates, deleted day, stale tag/kind as designed; no local/UTC date mixing found; money formatting is sign- and zero-aware; no `onClick` on non-interactive elements and every icon button carries a label; list keys are stable where state exists. **One lead worth a KI:** `MaxListenersExceededWarning: 11 close listeners added to [ServerResponse]` appears 299 times in the green e2e lane's server output and reproduces only under browser page loads (suspect Sentry 10 + Next 16 request instrumentation); no stack captured yet.

## Leads for a human with platform access

- Were migrations 0012–0015 dispatched to production? (`gh run list -w migrate-production.yml`) — F-C03.
- Triage the 17 Dependabot alerts on `main` — F-D06.
- Does Sentry project-level scrubbing already mask path tokens? Downgrades F-A07 to belt-and-braces if so; the in-repo scrub should still land.
- Is Copilot code review auto-requested by a ruleset? — F-D09 item 6.
- Does a failed Vercel production build notify anyone; what do per-push previews on `claude/*` branches cost? — F-D09.
- `INVITE_SUPER_CODE` has no lockout or per-IP limit; a sentence in SECURITY.md would settle whether that matters for a CSPRNG code.

## Method notes and assumptions

- Seven research agents ran in parallel from 00:31 PT; six independent verifiers re-traced every finding against the tree (streams A and D shared one). The session hit its usage limit at ~00:50 PT, killing four verifiers and stream G mid-run; work resumed at 07:31 PT. Stream G's lane logs survived in the scratchpad, so no lane was re-run.
- Assumption recorded: findings are **not** filed as KIs by this review. The register is for things knowingly left unfixed; this list exists to be fixed. Anything Mitchell defers can be moved with a `git mv` and a heading edit — every file already carries the KI fields.
- Assumption recorded: F-C05 was folded into F-B09 and D01/D02 into C03/A07 because a fixer should meet one file per insertion point, not two.
- The scratch reports (`/tmp/.../scratchpad/reports/`) hold each stream's full text including the route × authz table and the `/ask` flow map; they are not committed because they are superseded by `findings/`, but the two tables are worth lifting into the relevant spec if wanted.
