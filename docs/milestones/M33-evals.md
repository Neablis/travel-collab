# M33 — We can see whether an assistant change works before it ships

**Status:** Minted and built 2026-10-05, beside M31 and M32, on Mitchell's ask: *"start adding
evals so we can look at how this is working without this whole merge -> read logs of prod flow"*,
then *"make sure we are using the correct models in the evals to get a real check"*. He added a
Gateway key kept for evals, `TRAVEL_COLLAB_EVAL_KEY`, the same day.

## Why this exists

M32's two fixes (one call instead of ten, and a waking-day window) could only be checked by
merging, dispatching and reading production's logs. The repo had the two halves of an eval and
neither was it: `replay.int.test.ts` replays recorded model output through our code (it tests the
code around a model, not a model), and `pnpm live-set` sends the prompts to a deployment and
scores nothing.

## What it is

`pnpm --filter web eval` runs the live set (`live-set.json`) through the real `/ask` handler with
**no model injected**: admission, the intent classifier, tier selection, every tool, the proposal
builder and a migrated private Postgres holding the seeded Japan trip. Only place search (a stub
at its port) and auth (mocked as the integration lane mocks it) are not real.

- **Production's models, per tier** (`models.json`), read from what production actually ran
  (`ai_usage_steps`, `ai_usage.classifier_model`), not from the dashboard, where they are
  encrypted. A tier production has never run (strong, today) is not guessed: a turn that lands
  there fails, naming it. `EVAL_MODEL_<TIER>` overrides one tier to measure a candidate.
- **Checked by code, never by wording** (`grade.ts`): finishes, tool-call ceilings overall and
  per tool, must/never call, proposes or not, latency, input tokens, and, where the trip decides
  the answer, that it names the right day (computed from the seed by the domain, never typed in).
- **Expectations beside the live set, not in it** (`cases.ts`): the set's prompts are never
  edited; the bar is what moves. Every prompt must have one (`grade.test.ts`).
- **Its own network rule** (`evalNetworkGuard.setup.ts`): this machine, the database and the
  Gateway, nothing else.
- **Every run says what it will spend, and stops at a cap** (Mitchell, 2026-10-05, after a day of
  runs spent $0.25 unannounced). Without `EVAL_CONFIRM=1` a run prints its plan (turns, models,
  cap) and sends nothing. `EVAL_MAX_USD` caps it (default $0.10), priced by `spend.ts` with the
  cost ledger's own `microUsdForSteps`; turns past the cap are skipped. A model with no rate is
  refused, since its spend cannot be capped. The summary line reports what the run spent.
- **Not in CI or `pnpm check`**: every turn is paid. A report lands in `apps/web/eval-results/`
  (git-ignored), and any failed check is a red exit.

## First runs, 2026-10-05

**M32, before and after**, `q-most-free` ×3 each, same models, same seeded trip:

| | `main` (no M32) | M32 |
|---|---|---|
| Passed | 0 of 3 | 3 of 3 |
| Tool calls | 2, 15, 18 | 1, 1, 1 |
| Latency | 4.9s, 14.4s, 34.3s | 5.4s, 4.1s, 5.2s |
| Input tokens | 25,124, 10,508, 62,637 | 7,193, 17,313, 7,174 |
| Answer | day 10 once; "19 hours" (sleep counted) twice | day 1, 570 minutes, every time |

**The whole live set on M32**, once: 10 of 16 passed on the first run. Of the six failures, three
were the eval's own (fixed: a place stub that put every place in Kyoto, an expectation written for
a Niagara trip, a swap ceiling that ignored there is no swap command), one is the unconfigured
strong tier, and one is a production defect nobody had seen:

- **`KI-2026-10-05-a`**: *"How long is this trip?"* recorded as failed 4 of 5 runs on the cheap
  tier. The model invents a tool named `read`, reads the tool error and answers correctly; what
  failed the turn was our `onError`, which the UI stream calls to word every tool error and which
  latched the record as `error` and cleared the hard deadline. Fixed 2026-10-05 (the failure is
  now recorded only on the stream's `error` part); the same fix resolved `KI-2026-09-16-a`.

**Candidate cheap model, 2026-10-05** (`EVAL_MODEL_CHEAP=zai/glm-5.3-flash`, the mid tier's
model, on the four cheap-tier questions ×3): **12 of 12 passed, 1.9–4.1s each**, against 5–137s on
production's `zai/glm-4.7-flashx` for the same prompts. Switching `AI_MODEL_CHEAP` is Mitchell's
call; `glm-4.7-flashx` and `glm-5.3` have no entry in `modelRates.ts`, so their turns are unpriced.

## Exit gate

- [x] **`pnpm --filter web eval` runs the live set on a real model through the unmocked `/ask`
      handler**, on production's per-tier models, and refuses to start without
      `TRAVEL_COLLAB_EVAL_KEY`. *(2026-10-05: 16 prompts, report in `eval-results/`.)*
- [x] **The graders are unit-tested and each seen red** (`grade.test.ts`, 9 tests): the tool-call
      ceiling, day matching without word boundaries, an empty proposal passing a change,
      unreported tokens read as zero, and a typed-in day (`expected [9] to deeply equal [1]`).
      The network allowlist too (`evalNetworkGuard.test.ts`, a substring match → red).
- [x] **It reproduces a known production defect and shows its fix**: M32's table above.
- [x] **Every finding of the first full run is either fixed in the eval or filed** (above).
- [x] **The strong tier's production model is in `models.json`** (Mitchell: the id
      `AI_MODEL_STRONG` holds), and `t-reads-and-says-nothing` runs on it.
      *(Ticked 2026-10-05: Mitchell gave `zai/glm-5.3`. It ran, and FAILED: steps 2.0s + 104.7s,
      then the 240s deadline stopped the third; three reads, no proposal. One run, so not yet
      a rate; recorded in `KI-2026-10-04-c`.)*
- [ ] A retro is appended at gate close.
