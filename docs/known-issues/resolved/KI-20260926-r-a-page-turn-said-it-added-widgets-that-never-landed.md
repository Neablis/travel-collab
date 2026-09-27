### KI-2026-09-26-r — a notebook turn said it had added widgets, and the page did not change — RESOLVED

- **Severity:** correctness. The assistant told the user something was on the page that was
  not, and nothing on screen said otherwise.
- **Area:**
  - `apps/web/src/server/assistant/tools/page.ts` (`insert_widget`, `spelledParams`)
  - `apps/web/src/server/assistant/tools/widgets.ts` (`FILTER_VALUE_FORMS`)
  - `apps/web/src/server/ai/pageTools.ts` (`pageOutcomeOf`, `validateInsertsPerNode`)
  - `apps/web/src/server/assistant/deps.ts` (`PageBuffer`)
  - `apps/web/src/components/pages/PageScreen.tsx` (the `page-inserts` handler)
- **What happened.** Preview `dpl_9Cf1gFds98pM7tCW9ECTnv7cGRGR` (#251's branch, which does not
  include #250), trip `b18e7d5b…`, page `62b1a555…`, 2026-09-26, `zai/glm-5.3-flash`.
  - **20:16 turn.** `read_trip`, then `read_day` for [1..5], [6..10] and [11..14]. Then prose
    with trip facts in it, and `cost`, `count{of: stop}`, `stop.rows{…}`, `cost.chart` and
    `day.detail{view: schedule}`, each with `tag: ["meal"]`. Then the same widgets again with
    `tag: "meal"`. The log is truncated after that.
  - **20:20 turn** (its `ai.ask` line is present, 4 steps). Every widget call visible in the log
    passed `tag: ["meal"]`: `count`, `cost`, `cost.breakdown`, `cost.rows` and `stop.rows`.
  - Mitchell: *"it said it made a bunch of calls to change widgets but nothing really changed."*
- **Root cause.** Established by replaying the logged calls through the real tools
  (`pageTools.test.ts`, "the 2026-09-26 notebook turn, replayed"). There were two defects, and
  they compounded.
  1. **Every list-tag widget was refused at call time, and only the model was told.**
     - A widget filter holds ONE value: `TagRef = ActivityTag` (`packages/contracts/src/pages.ts`).
     - On the base, each `tag: ["meal"]` call returned
       `{ok: false, error: {reason: "bad-params", message: "Expected 'meal' | 'lodging' | …, received array"}}`.
       The replay shows `[false, false, false, false, false]`.
     - The model still wrote that it had added them. Nothing the server controlled told the
       user otherwise: the refusal existed only as a tool result.
     - Why a list: the input type is spelled `tags`, and `search_widgets`' `filterValues.tag`
       was the tag vocabulary as a JSON array.
  2. **What did validate never reached the document.** Runtime logs for 20:00–20:30 show no
     request at all to `/api/trips/b18e7d5b…/pages/62b1a555…` after either turn. An insert
     that lands in Editing is autosaved, so the client inserted nothing.
     - A new notebook opens in **Reading** (`PageScreen.tsx`: `useState(false)` unless arrived
       from Overview's Edit).
     - In Reading, `page-inserts` is declined, and one sentence is appended under the model's
       "I added…".
     - That is the likeliest reason. It cannot be proven from logs, because the client logs
       nothing.
     - **Resolved 2026-09-27** (ADR-058 decision 8, AGENTS.md invariant 7): an editor's page in
       Reading is switched to Editing — the Edit toggle's own state — and the inserts land and
       are saved by the edit session. A viewer stays in Reading and is told nothing went in.
       Proven by `PageAssistant.test.tsx` ("switches a page in Reading to Editing…", "does not
       switch a viewer's page…") and by the m10 e2e on a NEW notebook, which opens in Reading,
       asks for a meals notebook, sees the page in Editing with the widgets, and reads them
       back from the server after a reload. Seen red with the role read forced to "may not
       edit": the e2e's *"Expected substring: Switched to Editing to add"* failed, and the unit
       tests' *"Unable to find an element with the text: Bring a raincoat"*.
- **Ruled out, with evidence:**
  - **The all-or-nothing final check did not drop this batch.** The string-tag retries plus the
    prose validate as one 12-node document (reproduced). It was still a latent defect, since
    one bad node would have cost every good one, so it was fixed here too.
  - **`insert_widget` never reported success for a node refused later.** Its check and the
    final check are the same `insertWidget` call.
- **Fix:**
  - `insert_widget` unwraps a one-element list for a single-valued filter (`day`, `tags`,
    `city`, `kind`) and refuses a longer one with "takes ONE value, not a list".
  - It keeps one copy of a widget inserted twice with the same effective params, telling the
    model why.
  - It notes every refusal on the turn's `PageBuffer`. Only a later landing of the SAME call
    (same name, same params as written) clears it — a link retried once `get_widget` has listed
    its notebook. A different call of the same widget does not: `stop.rows {tag: ["meal",
    "sight"]}` refused and `stop.rows {tag: "meal"}` landed is "sight" dropped, and the user is
    told (#252's review, S2).
  - A turn that delivered inserts is never rolled back by the client, even when it then fails
    or is stopped; its answer says "Stopped partway — N blocks were added" (#252's review, S1).
  - The final check runs per node (`validateInsertsPerNode`). Valid nodes land. Refusals and
    drops ride `pageInserts.dropped` (contract), and the client writes them into the chat as
    "Not added to the page — …".
  - They are recorded as `ai.ask.droppedInserts`.
  - `filterValues.tag` and `.kind` are sentences ("ONE of …, never a list").
  - The compose instruction says each filter takes one value (ADR-058).
- **Seen to fail:** each test below was run against a deliberate source break, then restored.
  - `spelledParams`' unwrap disabled: *"expected [ false, false, false, false, false ] to deeply
    equal [ true, true, true, true, true ]"*.
  - Dedupe disabled: *"expected false to be true"*.
  - Batch validation restored in `pageOutcomeOf`: *"expected inserts, got {"composeError":
    "Nothing was added to the page. Refused: stop.rows, page — …"}"*.
  - Clearing by widget NAME (the first version's rule) restored: *"expected [] to deeply equal
    [ 'stop.rows' ]"*. `landed` made a no-op: *"expected [ { name: 'link.internal', …(1) } ] to
    deeply equal []"*.
  - The client's rollback of a text-less failed turn restored: *"Unable to find an accessible
    element with the role "log" and name "Conversation""*. The "Stopped partway" line
    disabled: *"expected 'Make a food notebook' to contain 'Stopped partway — 1 block was
    added…'"*.
  - `droppedInserts` not recorded: the route test *"expected [] to deeply equal [ 'stop.rows' ]"*.
  - The client notice disabled: *"Unable to find an element with the text: /Not added to the
    page — A line for every stop: tag takes ONE value/"*.
- **Check subset:** `pnpm --filter web typecheck`; unit `src/server src/lib src/components/pages`;
  `test:int` `ask/ src/server/ai src/server/assistant`.
- **Cross-reference:** `KI-2026-09-26-s` (the same afternoon's timeout), ADR-057 amendment,
  ADR-058.
- **First noted:** 2026-09-26, Mitchell on the preview.
