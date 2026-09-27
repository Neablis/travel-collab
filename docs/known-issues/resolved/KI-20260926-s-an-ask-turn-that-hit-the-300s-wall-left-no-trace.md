### KI-2026-09-26-s — an assistant turn that ran into the 300-second wall left no record and delivered nothing — RESOLVED

- **Severity:** reliability, with an observability hole. The user waited five minutes for
  nothing, and analytics could not see that it happened.
- **Area:**
  - `apps/web/src/server/ai/handleAskRequest.ts` (the agent's `prepareStep`, `stopWhen`, abort
    wiring and `messageMetadata`)
  - `apps/web/src/server/ai/askDeadline.ts`
  - `apps/web/src/app/api/trips/[tripId]/ask/route.ts` (`maxDuration`)
  - `apps/web/src/lib/apiClient.ts` (`askEventFromFrame`)
- **What happened.** On preview `dpl_9Cf1gFds98pM7tCW9ECTnv7cGRGR`, 2026-09-26, the `/ask`
  request logged at 20:09:25 carries an `ai.grant` line (surface `page`, taskClass `compose`)
  and then `Vercel Runtime Timeout Error: Task timed out after 300 seconds`.
  - There was no `ai.ask` line.
  - Nothing was inserted, because a page turn's inserts rode only the run's final `finish`
    chunk.
  - The user's next message was *"I don't see changes on the page, is this still running?"*
- **Why:**
  - The route declared no `maxDuration`, so it ran against the platform's wall with no deadline
    of its own.
  - `MAX_ASK_STEPS` (8) bounds round-trips, not time. Eight slow steps over a fourteen-day
    `read_day` payload are enough to reach 300s.
  - The recorder writes on `onEnd`, `onError` or the client's abort. A function the platform
    kills reaches none of them.
- **Fix (ADR-058 decision 6):**
  - The route declares `maxDuration = 300`. `ASK_MAX_DURATION_SECONDS` is the same number, and
    `askDeadline.test.ts` ties the two together.
  - **At 150s** (the step deadline) the turn starts no new tool step. It gets one tool-less step
    to say what it did.
  - **At 240s** (the hard deadline) the run is aborted with a `TimeoutError` reason.
  - What it had inserted rides the `abort` part as a `message-metadata` chunk, which the client
    now reads like `finish`.
  - The `ai.ask` record is written with `outcome: "abort"` and the deadline as its `cause`, and
    at error level as `ai.ask.failed`.
  - Both deadlines count from request entry, so admission and the classifier are inside them. A
    hard deadline already past when the run is set up aborts at once, and its listener checks
    `aborted` first, so it is recorded even when it fired during an await (#252's review, N4).
  - The client reads the `abort` part as a `stopped` event. A stopped turn with inserts says
    "Stopped partway — N blocks were added"; one with nothing says it took too long, rather
    than ending on an empty answer.
- **Seen to fail:** each test below was run against a deliberate source break, then restored.
  - `messageMetadata`'s abort branch disabled: *"TypeError: Cannot read properties of undefined
    (reading 'pageInserts')"*.
  - The deadline's `recorder.abandon` removed: *"expected { event: 'ai.ask', …(24) } to match
    object { outcome: 'abort', cause: { …(2) } }"*.
  - The step deadline disabled: *"expected [ [ 'read_trip', …(5) ] ] to deeply equal [ [] ]"*.
  - The client's `message-metadata` read removed: *"expected [] to deeply equal
    [ { type: 'page-inserts', …(2) } ]"*.
  - The route's `maxDuration` changed to 800: *"expected 800 to be 300"*.
  - The deadline listener without its `aborted` check: *"expected [] to have a length of 1 but
    got +0"*. The recorder's single-writer latch removed: *"expected [ … ] to have a length of 1
    but got 2"*.
  - The client's `abort` → `stopped` read removed: *"expected [] to deeply equal [ { type:
    'stopped' } ]"*. The empty-stop line disabled: *"expected 'Make a food notebook' to contain
    'took too long and was stopped'"*.
- **Check subset:** `pnpm --filter web typecheck`; unit `src/server/ai src/lib`; `test:int`
  `ask/route` ("page authoring").
- **Cross-reference:** `KI-2026-09-26-r`, ADR-058.
- **First noted:** 2026-09-26, from the preview's runtime logs.
