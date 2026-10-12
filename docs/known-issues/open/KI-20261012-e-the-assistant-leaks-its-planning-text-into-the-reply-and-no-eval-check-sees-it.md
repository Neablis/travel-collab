### KI-2026-10-12-e — the assistant leaks its planning text into the reply, and no eval check sees it

- **Severity:** minor-to-major for the product (a person reads the assistant's working notes run
  into its answer, with no space between them); correctness of the eval, which passed the turn.
- **Area:** the agent loop's UI stream in `apps/web/src/server/ai/handleAskRequest.ts`
  (trip turns: `agent.stream` at `:908`, `result.toUIMessageStream` at `:919`; the account
  ask repeats it at `:1198`/`:1202`), the reply rule in `instructionBlocks` (`:1902`), the client's text accumulation in
  `apps/web/src/lib/apiClient.ts:1741` and `apps/web/src/components/assistant/useAskThread.ts:328`,
  and the eval: `apps/web/src/server/ai/eval/live.eval.ts:211-214` (how `turn.text` is built),
  `apps/web/src/server/ai/eval/grade.ts:129` (`grade`) and
  `apps/web/src/server/ai/eval/cases.ts:99,129`. Line numbers are at `main` `d34abe5`.
- **Symptom:** live eval, 2026-10-12, at `main` `d34abe5`, case `t-mangled-tool-input#1`
  (*"add a coffee stop to day 1"*), `anthropic/claude-sonnet-5.5`, mid tier, 4 steps, 3 calls
  (`read_day`, `search_places`, `AddActivity`), 7.7s. The whole reply, verbatim:

  > Gap 5:30–7 pm. Look up a cafe in Shibuya.I'd add a "Coffee break in Shibuya" stop to day 1,
  > from 5:45 to 6:30 pm. That fits the gap between the Trunk Hotel check-in, which ends at
  > 5:30 pm, and dinner at Gonpachi at 7 pm. […] The change is waiting for your approval.

  The first two sentences are the model's note to itself between tool calls; the missing space
  in `Shibuya.I'd` is the seam between two steps' text. The case **passed** all four of its
  checks (`completes`, `≤ 10 tool calls`, `proposes a change`, `≤ 120s`), because none of them
  reads the reply's text.
- **Likely cause (inferred, not traced in a debugger):** the reply is every step's text, not the
  last step's. `toUIMessageStream` (`handleAskRequest.ts:919`) forwards each step's text parts as
  they stream, so text a model writes *alongside* a tool call in step 1-3 reaches the client as
  part of the answer; the client appends every `text` event to one string with no separator
  (`apiClient.ts:1741`, `useAskThread.ts:328`), and the eval does the same
  (`live.eval.ts:211-214`, `.join("")`). Nothing in the system instruction tells the model not to
  write text alongside a tool call: the only reply rule is *"Answer in prose, briefly — a
  sentence or three"* (`handleAskRequest.ts:1902`). It is the model's visible text, not its thinking: the eval keeps only `text-delta`
  chunks, and reasoning streams as `reasoning-*`. Sonnet usually writes nothing before a tool
  call, so this is intermittent; one occurrence in one run.
- **Fix direction (two halves, either alone helps):**
  1. **Product.** Either add a rule (*"Do not write any text in a step where you call a tool;
     write the answer only once, after your last tool call"*), or stop forwarding text from a
     step that ended in tool calls (filter the UI stream so only the final step's text parts
     reach the client). The rule is cheap and leaves the occasional slip; the filter is
     structural, but needs care that a deadline-cut turn still shows something.
  2. **Eval.** Add a default-on check in `grade.ts`, e.g. `"no text before a tool call"`: from the
     stream chunks `live.eval.ts` already parses, fail when any `text-delta` precedes a
     `tool-input-start` / `tool-call` chunk (a structural signal, not a phrase list), and keep a
     cheap textual backstop — a sentence end run into the next sentence, `/[a-z][.!?][A-Z]/`,
     which is what this reply's seam looks like. Prove it red against this answer first.
- **Related eval-coverage gap, same run:** `t-reads-and-says-nothing#1` (*"plan me a six day trip
  to Kyoto"*, `anthropic/claude-opus-5.5`, strong tier, `read_trip` + `read_day`, 14.4s) only
  described the trip's existing Kyoto days and asked which days to give up. It passed on
  `completes`, tool count and latency alone (`cases.ts:129` sets `proposes: undefined`). Asking is
  a fair answer on this seed (the case comment at `cases.ts:124-128` says so), but the case
  cannot tell that fair question from a turn that reads and only summarises: a check that the
  reply either proposes something or ends in a question would separate the two.
- **First noted:** 2026-10-12, M45, from the live eval run at `main` `d34abe5`.
