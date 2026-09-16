### KI-11 — No AI test ever calls a real model, so the "real model ≠ mock" bug class is invisible to CI — RESOLVED, by the replay lane rather than by a live call
- **Severity:** reliability (no failing behavior today; the gap is in what CI *can* detect)
- **Area:** `apps/web/src/app/api/trips/[tripId]/ask/route.int.test.ts` (every test injects `simulatedModel()`), `apps/web/src/server/ai/*`. Filed against the `/ai` suite, which ADR-033 Decision 4 deleted along with its endpoint; the gap is identical on the door that replaced it.
- **Symptom:** the AI suite has been green through **seven** consecutive real-world AI failures (2026-07-21 → 07-26): an envelope missing ids so the model emitted zero tool calls; three separate verbatim-UUID/format classes (KI-8); a no-op sub-command aborting a whole batch; same-batch day refs resolving against pre-batch state; an append-only projection missing removals/moves; and the `MAX_STEPS` truncation fixed in `e9fe19b`. Each was found by Mitchell manually prompting the deployed build, never by a test.
- **Why it happens:** `MockLanguageModelV4` is a scripted `doGenerate` — by construction it emits well-formed tool calls, emits them exactly when told, and stops when told. Real models do none of these reliably: they invent or mangle ids, choose wrong formats, emit redundant commands, split work across many steps, and run past a step budget. A mock validates *our* code path given well-formed input; it cannot generate the malformed input that has caused every actual bug. This is a structural limit, not a missing assertion — no amount of additional mocked tests closes it.
- **Why it isn't fixed:** a live-gateway test costs money per run, is non-deterministic (so it can't gate CI on equality), and needs `AI_GATEWAY_API_KEY` in CI. The M7 exit gate's **"AI demo"** box was checked with an explicit waiver on exactly these grounds — honestly recorded, and it is the one waived criterion that would have caught all seven.
- **Mitigation:** a per-turn record is the substitute and has diagnosed every one of these — **keep it and extend it, don't trim it for token cost.** It was `handleAiRequest.ts`'s `meta` envelope (`AiCallMeta`); since ADR-033 Decision 4 it is the `ai.ask` analytics line (`askAnalytics.ts`), which carries the same facts plus the tool-call trace, the classification verdict and the failure cause. After any AI-layer change, run a live prompt and read it: `steps` at exactly `MAX_ASK_STEPS` **plus** `finishReason: "tool-calls"` means truncation; `toolCalls` empty means the model refused the tool surface; `droppedCalls` non-empty means refs failed. **A run ending at exactly the configured ceiling is a budget problem until proven otherwise** — that signature appeared twice five days apart and was misread the first time as weak-model over-generation.
- **Possible real fix (unscoped):** a small non-CI harness that replays a fixed prompt set against several gateway models and records the `meta` we already emit — overlaps the "best model for my buck" item in `TODO.md`, which would supply the same infrastructure.
- **First noted:** 2026-07-26 (M7 post-gate retro).

- **RESOLVED 2026-09-16 (M9), by the thing this entry itself proposes** — *"a small non-CI harness that replays a fixed prompt set… and records the `meta` we already emit"* — built as a CI lane instead of a non-CI one, because the recording is what makes it deterministic.

  **`src/server/ai/eval/` is the harness.** A *transcript* is the provider traffic
  for one turn: the content parts per step, the finish reason, and the
  classifier's verdict, with `input` kept as the JSON **string** the SDK's
  contract says it is. `replayTranscript` turns one into a `LanguageModel`;
  `replay.int.test.ts` drives the real `handleAskRequest` with it. So the model
  is a recording and everything else is the shipped path — admission, the real
  tool schemas, `repairToolInput`, `resolveBatch`, `buildProposal`,
  `groundCitedPlaces`, the fences.

  **Why this is not the mock this entry rules out.** The entry's argument is
  exact and it is about where the bytes come from: *"a mock validates OUR code
  path given well-formed input; it cannot generate the malformed input that has
  caused every actual bug."* A transcript is not written to make a test pass —
  it holds what a provider put on the wire, including a mangled tool input, a
  verbatim UUID where a ref was asked for, a turn that read four tools and
  emitted nothing, and a fabricated `amountMinor: 0`. Every assertion is about
  SHAPE, never about prose: steps, tool names in order, dropped calls, proposal
  size, and the invariants the gate names.

  **It earned its keep on the first run.** Replaying the truncated-tool-input
  transcript showed that such a turn still dies whole, losing the reads it had
  already paid for — filed as **KI-2026-09-16-a**. That is the exact class this
  entry says is invisible to CI, found by CI.

  **What is honest about the transcripts committed today, and it is stated in
  the harness rather than buried here.** Every transcript declares its `source`.
  The five that ship are `synthetic` — hand-written FROM a recorded incident,
  each naming the incident — because no lane in this repo has a gateway key.
  That is worth having and it is NOT the same as a recording: a synthetic
  transcript can only contain a failure somebody already knew about.
  `recordAskTranscript` is the wrapper that produces a `recorded` one from a
  live run, and the harness documents the three lines.

  **So the gate's OTHER box is untouched, deliberately.** *"At least one exit
  criterion is a real, non-mocked model call, with its `meta` pasted into this
  file"* still needs a live key, and nothing in this lane may be presented as
  one. The harness says so in its own header.

  **The mitigation this entry names stays exactly as written** — the per-turn
  `ai.ask` record is still the substitute for a live run, and the signatures it
  tells you to read (`steps` at the ceiling plus `finishReason: "tool-calls"`,
  empty `toolCalls`, non-empty `droppedCalls`) are now the things the replay
  lane asserts automatically on a fixed set.
