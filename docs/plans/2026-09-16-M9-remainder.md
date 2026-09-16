# M9 remainder — the assistant cites what it plans

**Written 2026-09-16.** Covers the build-order items of
`docs/specs/2026-09-15-M9-assistant-and-new-trip-design.md` §8 that are **not**
covered by a plan already, and says for each whether this session builds it.
It is the index plan that `docs/milestones/M9-ai-planning-partner.md`'s plan
table names as "not written yet" — six of them, collapsed into one document
because three are one dependency chain and two are a handful of files each.

Read `docs/milestones/M9-ai-planning-partner.md` first, then the design spec.
This plan restates neither.

## What this session builds, and what it does not

The design's build order, with state. **Plan 1 is merged** (`cacc1af`, #178)
and **plan 4 is written and unexecuted** (`aee080a`, #183); neither is restated
here.

| # | Item | This session |
|---|---|---|
| 1 | KI-94 + the refund primitive | **Merged** — plan 1 |
| 2 | The transcript rebuild (§2a/2b/2d) | **No** — UI typography, own plan, no gate box |
| 3 | The theme authoring pass — 148 days | **No** — content authoring, and §10.6 is unanswered (who authors it) |
| 4 | The four-turn transcript | **No** — plan 4 is written and carries three decisions Mitchell owes |
| 5 | **Grounding + KI-93** | **Yes** — §A and §B below |
| 6 | `TripStatus: "draft"` | **No** — its own contracts PR (AGENTS.md reserves one), and only the paid fork consumes it |
| 7 | The paid fork | **No** — depends on 4 and 6 |
| 8 | **Escalation + `certainty`** | **Yes** — §D below |
| 9 | **The eval/replay harness** | **Yes** — §E below |
| 10 | **KI-12** | **Yes** — §C below. The design lands it "across 4 and 7"; it does not have to be, and the reason is below |

Plus **conversation durability** (§6 of the design — `localStorage` only, no
table), which the build order does not number because it is not in anyone's
dependency chain, and which is one of the three things the milestone's own
title-line names as remaining. §F below.

**Why this cut.** Four of M9's gate boxes are unticked and buildable: KI-93,
KI-12, the replay harness, and the grounding behind the Rochester box. Every
one of them is in the list above. The five items this session does not build
are UI, content, or a contracts PR that only an unbuilt consumer needs — none
of them ticks a box, and item 3 additionally has an unanswered ownership
question (§10.6). Items 2/4/6/7 stay for their own plans; nothing here
forecloses them.

---

## A. Grounding — the assistant cites what it plans (build order 5)

**The guarantee.** `idFields.ts` already makes the model structurally incapable
of naming a UUID it did not read. Grounding extends exactly that to places: a
write tool cites `placeRef: N`, an index into the turn's own search results,
and **the server resolves it**. A place the model did not search for has no
number, so it cannot be cited — the model does not get to type coordinates.

**The citation half already exists.** `01f7743` (#166) put `placeRef` on
`AddActivity` and `UpdateActivity` in `@tc/contracts`, with
`packages/contracts/test/m9-place-ref.test.ts` asserting it is a **transport
field only** — the stored `ActivityAddedV1`/`ActivityUpdatedV1` payloads have
no such key. That property is what makes the resolution below safe to do
server-side and then drop: nothing downstream of the proposal has ever seen a
`placeRef`, so nothing downstream has to learn to.

### A1. The port and the cache

Two additions to `AssistantDeps` (`server/assistant/deps.ts`), because a tool
may reach only what it declares:

- **`placeSearch: PlaceSearchPort`** — `search(queries, viewbox)`. A port for
  the same reason `playbooks` is one: the kernel's import wall is
  deny-by-default over `@/server/**`, and `getGeocoder()` is behind it. The
  adapter lands in `server/ai/assistantPorts.ts` beside the other two, and it
  is where the geocode quota is charged (§B).
- **`placeCache: PlaceCache`** — per-turn, minted beside the two existing
  buffers, numbered from 1 in the order the model saw them. A collector, not a
  closure, for the reason `deps.ts` already gives about `ProposalBuffer`.

`TURN_DEP_KEY_SET` gets both keys, which is what makes forgetting to supply
one a compile error rather than a mid-turn throw.

### A2. The tool

`search_places`, in a new `server/assistant/tools/places.ts`:

- `domain: "places"` — the first tool to use it. `SURFACES`' `trip` and `day`
  rows gain `{ domain: "places", max: "read" }`; the `page` row does not (a
  page turn composes prose, and giving it a vendor-spending tool would be
  spend with nothing to buy).
- `effect: "read"`, `minimumRole: "viewer"` — it reads a public gazetteer.
- **`spend: "vendor"` — the first tool that declares it.** That tag has been
  recorded and read by nothing since P5; M9 Phase 0's own note says the reason
  is that the real LocationIQ door was on the apply path and not a tool at all.
  After this there are two doors and both are declared.
- **One call, an array of queries** (scope: *"one call, array of queries, each
  region-biased"*). The step cost is what the milestone says to watch: search
  then act is 2-3 steps, not one step per place.
- `taint` — every candidate's `name` is OpenStreetMap-derived, written by a
  stranger. It is fenced, and `toolResults.taint.test.ts` sweeps for it without
  being edited.

Region bias is `viewbox` + `bounded: 0` around the trip's own geocoded
activities — `geocodeRegion.ts`'s `boundingBoxAround`, reused, never restated.
A trip with no coordinates yet biases on nothing, which is honest.

### A3. The resolution, and where it happens

**In `buildProposal`, server-side, before the user ever sees the card.** A
command carrying `placeRef: N` has its `location` replaced by candidate N's
name and coordinates; the `placeRef` is then dropped. Three consequences, each
of which is the point:

1. **The card the user approves names the place the server found**, not the
   place the model typed. The same rule `insert_playbook_day` already follows.
2. **`placeRef` never leaves the server**, so `/ask/apply` needs no new
   trust — a client cannot post one back, because there is no cache to resolve
   it against on that path and `parseApprovedCommands` strips it.
3. **A cited stop arrives at enrichment already verified**, so the blind
   post-hoc geocoder does not touch it. That is KI-15's architectural half:
   enrichment is demoted to a fallback for locations nobody searched for —
   user-typed text, and a model that named a place without citing one.

An unresolvable `placeRef` (out of range, or no search this turn) does **not**
fabricate: the citation is dropped, the command keeps whatever free-text
location it had, and the proposal's `skipped` names it. A refusal the user can
see beats a coordinate nobody checked.

---

## B. KI-93 — every vendor call goes through the quota (gate box)

Two doors into `LOCATIONIQ_API_KEY`, and after §A there are exactly two:
`commitProposal`'s `enrichCommandLocations` on the apply path, and
`search_places`'s port on the ask path. Both charge `geocodeQuota()`.

**The mid-batch decision the entry says is a product call, taken here:** a
ceiling reached mid-batch **stops further lookups** and does not fail the
request. The entry's own fix path argues for it — enrichment is explicitly
best-effort and never fails the request — and the alternative turns a daily
ceiling into an outage on a path that already degrades gracefully. So the check
goes **inside** the loop, the names past the ceiling are reported the way
`MAX_LOOKUPS_PER_BATCH` already reports `skipped` names, and the batch commits
with those stops unpinned.

`search_places` is the other half and takes the opposite posture, because it is
not best-effort: a refusal there is a tool result the model reads and can talk
about, which is the recovery path enrichment does not have.

**This is a charge, not a reservation.** One lookup, one charge, settled as it
happens — the denominator `geocodeQuota`'s own comment says is already right.
No `reserveAiSteps`-style pre-authorisation, because there is nothing to refund.

---

## C. KI-12 — the AI cannot leave a trip half-planned (gate box)

**The entry is stale in its diagnosis and live in its symptom.** It says *"there
is no `SetTripName` command anywhere in the contract"*. There is — `SetTripName`
and `SetTripDates` are both `BatchableCommand` members and both are derived into
tools. What stops a plan turn using them is two things that arrived later:

1. **`TASK_CLASSES_FOR` in `tools/planning.ts` removes `SetTripName` from the
   `plan` class** — P5's tool-count cut, whose own comment predicts exactly this
   dead end (*"plan me a trip and rename it to Japan 2027" gets the plan and no
   rename*) and prices it at one extra turn.
2. **Nothing tells the model to name or date a trip that has neither.** The
   dates half was always only a prompt gap; the entry says so.

So the fix is two lines of data and one prompt block, and it does **not** need
to wait for build-order items 4 and 7 the way the design assumes:

- `SetTripName` leaves `TASK_CLASSES_FOR`, so a plan turn is offered it. That
  is the deletion its own comment names as the fix *"if it proves annoying"*,
  and a gate box is a stronger reason than annoyance. It takes the plan turn
  from 13 tools to 14, which stays inside the band P5 moved it into.
- **A prompt rule, conditioned on the trip's own state** — server-computed, so
  it is a `rule` block and not user text: when the trip still carries its
  default name or has no dates, a planning turn names it and dates it **in the
  same batch**. Conditioned, because a trip the user already named must not be
  silently renamed — the product question the entry says needs deciding, and
  the answer that needs no round-trip.
- **Dates with no stated start** stay the model's to ask about. The rule says
  to set the dates the request implies, not to invent a departure date.

---

## D. Escalation and `certainty` (build order 8, design §1)

Mitchell: *"i really dislike how the AI right now will ask me to reframe a ask
in order for it to do the work. It should do what it needs to do."*

The diagnosis is the design's: `withheld` is an editor whose turn the classifier
read as a question, and **the defect is that there is no recovery path**, so a
misclassification costs a whole turn.

- **`certainty`** — the classifier says how sure it is, and an uncertain
  verdict resolves **upward into `withheld` rather than downward**, which is
  what makes the escalation below reachable at all rather than a second guess.
- **The escalation tool** — offered **only** in the `withheld` posture. Calling
  it says the turn needs the write tools after all; the turn re-enters with
  them rather than restarting and rather than asking the client to retry.
- **The property, not the scenario** (design §9): `withheld` is by definition
  where role and plan both permit `propose`, so assert that the escalation tool
  is never offered outside it and the claim holds for cases nobody enumerated.
  A scenario test over three postures would not.
- **KI-2026-09-12-a closes as a side effect.** The simulated classifier emits
  only `plan` or `question`, so `edit` is unreachable in the integration suite;
  adding `certainty` means touching that model anyway, which is the moment to
  give it the `edit` verdict.

---

## E. The eval/replay harness (build order 9, gate box, closes KI-11)

*"Recorded real-model transcripts replay in CI without a live call."*

- **A transcript is a fixture**: the recorded provider traffic for one prompt —
  the steps, the tool calls with their inputs, and the final text.
- **The replay lane runs the real handler** with the provider stubbed by the
  transcript. That is what makes it worth its cost: the tool schemas, the
  admission pipeline, `resolveBatch`, `buildProposal` and the fences are all
  the shipped ones, and only the model is a recording.
- **The eval set is small and fixed**, and the assertions are about **shape**,
  not about the model's prose — how many steps, which tools, whether the
  proposal is well-formed, whether any fence leaked.
- **It runs last** in the build order because escalations are labelled misses,
  and it is fed by §D.

**What it cannot do**, said here so the gate does not over-claim: a replay is
evidence that the code around the model is sound. It is **not** the gate's
other box — *"at least one exit criterion is a real, non-mocked model call"* —
and nothing in this harness is allowed to look like it. That box needs a live
key, which no lane in this repo has.

---

## F. Conversation durability — `localStorage`, no table

Design §6, and Mitchell's decision: *"`localStorage` only. No table, no
migration."* One of the three things M9's own audit lists as remaining (*"its
conversation survives a reload"*), and the audit's note is the requirement:
**messages ride the request and there is no conversation table, so a reload
loses the thread.**

Per trip, bounded, and dropped when it is stale. No server change at all —
which is why it is not in the numbered build order and why it is safe to land
beside everything else.

---

## Verification

Tier 2 while the branch is open (`minimal-check-subset`), Tier 3 once at final
review. Every test seen to fail for its own reason before it counts —
CLAUDE.md rule 3, and the M9 Phase 0 retro's own lesson that a mock is a
boundary and the code on the far side of it is untested until something asserts
the wire. The port in §A1 is exactly such a boundary, and §B is a charge that a
mocked port would never prove happened.

## What must not happen

- **No coordinate the model typed reaches a stored event.** If a `placeRef`
  cannot be resolved, the citation is dropped — never guessed at.
- **No third door into the vendor key.** After §B the set of spending paths is
  a filter over the registry plus one named call site, and it stays that way.
- **`placeRef` does not become a client-supplied field.** It is resolved and
  dropped server-side, before the proposal is serialised.
- **No conversation table.** §F is `localStorage` and Mitchell decided it.
- **The replay harness never presented as a live-model record.** §E's own note.
