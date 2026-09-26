# ADR-058: A turn starts in an intent, holds that intent's tools, and can switch once it knows better

**Status:** **Proposed — 2026-09-26.** Mitchell's direction in chat (below) is the mandate; the
design details are the implementer's, pending his review (listed at the end).
**Deciders:** Mitchell (product/eng); Claude — drafted
Amends: **ADR-057** (the page turn's instruction and tools; see its amendment note),
**ADR-043 decision 4** (a page turn is `compose` by construction and never classified).
Related: **M9 design §1b** (the board's escalation, which this generalises), `askIntent.ts`,
`grants.ts`, `KI-2026-09-26-r`, `KI-2026-09-26-s`.

## Context

On 2026-09-26 Mitchell asked a new notebook page for "a notebook about just meals" (preview of
#251, `zai/glm-5.3-flash`, tier mid). The first turn ran into Vercel's 300-second wall and left
no `ai.ask` record and no draft (`KI-2026-09-26-s`). The follow-up read the trip, then every day
in three `read_day` batches, wrote prose with the trip's current facts in it ("14 days",
"landing in Tokyo", four named restaurants still to book), and inserted widgets with
`tag: ["meal"]`. A widget's tag is one value, so each of those was refused. The reply said it
had added them, and the page did not change (`KI-2026-09-26-r`).

Mitchell:

> *"It took a really long time. It searched through all the activities despite having all the
> widgets to do that work for them. Let's focus on generic solutions on notebooks rather than
> specific activities. After the notebook is created the data can change, so scanning there
> wasn't very useful."*

> *"Notebooks should rarely need to scan the trip, these are generic widgets being inserted to
> display any trip, but when asking questions about a trip, you should know the trip shape. I
> would try to categorize the intent at start, insert the correct tools, but be able to pivot
> in the tool chain if we find ourself wrong partway through."*

The page surface had one turn shape. It was `compose` by construction, held every read tool,
and was told to "call read_trip first … and read_day for what happens on a day". A question
asked beside a notebook got the same turn as a notebook asked for.

## Decision

1. **Intent is `TaskClass`, and each surface declares its own** (`assistant/intents.ts`,
   `SURFACE_INTENTS`):

   | Surface | Starts in | May be in | Pivots with |
   |---|---|---|---|
   | `trip`, `day` (board, phone) | `question` | `question`, `edit`, `plan` | `request_change_tools` (M9) |
   | `page` (notebook) | `compose` | `compose`, `question` | `switch_intent` (new) |

   The phone asks through the same three scopes, so it has no row of its own.

2. **A page turn is classified.** It is classified once, before the turn, by the existing
   classifier, which now has a page variant (`askIntent.ts`, `PAGE_INTENT_INSTRUCTION`,
   `{intent: compose|question, certainty}`). The page variant fails open to `compose`, the
   surface's default, not to the board's `plan`. The verdict goes on the `ai.ask` record as
   `classification`, as the board's does.
   - **The page verdict chooses a profile and never an effect.** `caps.classifier` stays
     `propose` on a page, so a pivot back to `compose` stays inside what admission granted.
   - **A page turn always narrows**, even on an `unsure` or failed-open verdict. The board's
     rule that "only a determined class narrows" exists because the board's recovery used to
     be the user asking again. A page turn can pivot instead.

3. **Profile: intent → instruction and tools.** The instruction is one table per surface
   (`PAGE_INTENT_RULES` in `handleAskRequest.ts`). Tool membership stays a tag on each tool
   (`taskClasses`), per `grants.ts`'s rule that a tool's membership is never written in a list
   somewhere else. The table below is what those two produce on a page, measured on a 14-day
   factory trip. Characters are JSON name + description + parameter schema; divide by four for
   tokens.

   | Page intent | Instruction says | Tools offered | Tool schemas | Instruction |
   |---|---|---|---|---|
   | *before, #251 (the preview)* | read the trip first, read days; the whole widget catalogue | read_trip, read_day, find_free_time, search_playbooks, insert_text, insert_widget | not re-measured | 15,804 (ADR-057) |
   | *before, #250 (this branch's base)* | read the trip first, read days; search for widgets | the six above + search_widgets, get_widget (8) | 6,821 | 2,684 |
   | `compose` | a notebook is a live view; filters select the data; read no day or stop; write no current trip fact into prose; each filter takes ONE value; insert each widget once | read_trip, search_widgets, get_widget, insert_text, insert_widget, switch_intent (6) | 4,818 | 3,211 |
   | `question` | answer in the chat; read_day with a list; the page can't change on this turn — switch to compose if asked | read_trip, read_day, find_free_time, search_playbooks, switch_intent (5) | 4,134 | 1,359 |

   - The fixed cost per step is 9,505 characters before and 8,029 on `compose` (−16%). It is
     5,493 on `question` (−42%).
   - What matters more is what the fixed cost no longer invites. Three `read_day` batches over
     fourteen days are the largest tool results this route produces. The follow-up turn
     re-sent them on every later step.
   - `compose`'s instruction grew by the trip shape (below) and by the rules that replace
     reading.
   - The board's rows are unchanged. `read_day`, `find_free_time` and `search_playbooks` are
     tagged `question`/`edit`/`plan`, which covers every board class.

4. **The page instruction carries the trip's shape, never its stops** (`tripShapeOf`). The
   shape is the day count, the start date, the cities, and the tags and kinds in use, as a
   `data` block, because city names are user-authored. That is all a filter is chosen from, so
   a compose turn needs no read to pick `tag: "meal"`, and a question turn starts knowing where
   it is.

5. **`switch_intent({to, reason})` pivots a page turn.**
   - It is offered only when the turn has more than one reachable intent.
   - An intent is reachable when the turn's grant already holds what that intent needs
     (`INTENT_REQUIRES`: `compose` needs `pages: propose`). A pivot chooses among sets that
     admission built and checked against `minimumRoleFor`, and it never widens them.
   - A turn may pivot at most twice (`MAX_PIVOTS`).
   - The pivot takes effect on the next step. `prepareStep` swaps in that intent's active
     tools, its model tier and its instruction.
   - Every pivot is recorded as `pivots: [{from, to, reason, step}]` on `ai.ask`. A board
     escalation is recorded there too, as the question→edit pivot it always was.

6. **Deadlines** (`askDeadline.ts`). The route now declares `maxDuration = 300`, the wall the
   platform was already enforcing. Two deadlines are derived from it and measured from request
   entry:
   - **Step deadline, at 150s.** No new tool step starts after it. The model gets one last
     step with no tools to say what it did.
   - **Hard deadline, at 240s.** The run is aborted, with a `TimeoutError` reason so the SDK
     ends the stream with an `abort` part. The inserts drafted so far ride that part as a
     `message-metadata` chunk, and the `ai.ask` record is written with `outcome: "abort"` and
     the deadline as `cause`.

7. **A page turn's inserts are judged one node at a time** (amends ADR-057; see
   `KI-2026-09-26-r`):
   - At call time, `insert_widget` unwraps a one-element list for a single-valued filter. It
     refuses a longer list in words the model can act on.
   - It keeps one copy of a widget inserted twice with the same effective params.
   - It records each refusal on the turn's buffer.
   - At the end, each node is validated alone. Valid nodes land, and the rest are named in
     `pageInserts.dropped` (a contract addition) and in `ai.ask.droppedInserts`.
   - The client writes each dropped insert into the chat under the model's own reply, because
     the model may claim it added them.

## Consequences

- **A page turn now pays for a classification round-trip.** It is billed like the board's
  (`billableRoundTrips`) and adds ~1.5s. That cost buys the split. A `question` on a notebook
  also moves to the cheap tier.
- **Page turns are now diagnosable by intent.** `classification.taskClass`, `pivots` and
  `droppedInserts` make a misread page turn and a lost insert visible in the `ai-usage`
  skill's records.
- **A turn can no longer die at the wall silently.** The worst case is a draft delivered at
  240s with an `abort` record naming the deadline.
- **Contract:** `DroppedInsert`, and `pageInserts.dropped?` (additive, optional). See
  `docs/contracts/CHANGELOG.md`.

## Not decided here — review points for Mitchell

1. **Reading mode still refuses inserts.** A new notebook opens in Reading. Inserts that
   arrive then are declined, with a sentence appended to the answer. The 2026-09-26 page shows
   no save after either turn, which fits that. Should a page turn that composes put the page
   into Editing instead?
2. **The board keeps `request_change_tools` instead of getting `switch_intent`.** Its three
   intents already have a pivot (question→edit). `plan`↔`edit` has none, deliberately: nothing
   in the records shows a turn that wanted it.
3. **Search does not find a topic word.** `search_widgets("meals")` returns one withheld
   breakdown, because widgets are named for what they show. The compose rules now say the
   topic is the filter. Adding tag words to the search index is the other half, and is not
   done here.
4. **Deadline values.** 150s and 240s are derived fractions of the wall, not measurements of
   real turns. Re-derive them from `ai.ask` latency once the records exist.
