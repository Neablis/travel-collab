### KI-2026-09-05-z — `MaxListenersExceededWarning: 11 close listeners added to [ServerResponse]` appears 299 times in a green e2e run, with no stack captured

- **Severity:** reliability — **unconfirmed**. This entry exists so the observation is not lost, not because a defect is established. No test fails and no user-visible symptom is known.
- **Area:** unknown. Reproduces only under browser page loads against `next start`, not under the unit or integration lanes. The suspects are Sentry 10's request instrumentation and Next 16's — `apps/web/instrumentation.ts`, `sentry.server.config.ts`, `sentry.shared.ts` — but nothing has been traced.
- **Symptom / What happens:** the warning is emitted **299 times** in the server output of a `pnpm --filter web test:e2e:ci-like` run that passed 89/89 in 2.1 minutes with 63/63 teardown. Node emits it when one emitter passes 10 listeners, which usually means a per-request listener is being added to a long-lived object without being removed — the shape of a slow leak under sustained load. On a serverless deploy each invocation is short-lived, so it may never matter; on a long-running process it might.
- **Why not fixed here:** found by a read-only review; no code was changed by it, and the stream that found it was asked for lane results rather than for a root cause. Nobody has captured a stack.
- **Suggested next step:** re-run the ci-like lane with `node --trace-warnings` (or `events.captureRejections`/`emitter.setMaxListeners` instrumented in `instrumentation.ts`) to get one stack, which should name the adder immediately. Do that **before** raising the limit — raising it hides the count without answering the question.
- **Cross-reference:** `../../reviews/2026-09-05-overnight-review/README.md` §G, which flags this as "one lead worth a KI"; ADR-032 (Sentry); KI-2026-09-05-y item 4 (the other source of console noise in the same lane).
- **First noted:** 2026-09-05, overnight review stream G, in the lane output of an otherwise fully green run.

- **Reproduced again 2026-09-07, and the conditions are now narrower.** Seen
  during the `/ki-sweep` Tier 3 run on `claude/ki-sweep-cphxh2`:
  `pnpm --filter web test:e2e:ci-like` → **103 passed (4.1m), exit 0**, with the
  warning repeating throughout the `[WebServer]` output:

  ```
  [WebServer] (node:5683) MaxListenersExceededWarning: Possible EventEmitter memory
  leak detected. 11 close listeners added to [ServerResponse]. MaxListeners is 10.
  ```

  What this adds to the entry: it is **not** specific to a branch or a change —
  this run's diff touches `layout.tsx`, `(app)/page.tsx`, `PageScreen.tsx` and
  `server/projections.ts`, none of which is a suspect — and it does **not**
  fail or flake the suite, which stayed green with zero retries. `ServerResponse`
  as the emitter, and 11-against-10, are both consistent with the entry's
  standing suspicion of per-request instrumentation (Sentry 10's or Next 16's)
  adding one listener per response beyond Node's default ceiling. Still not
  traced to a line; still no test fails. Recording the reproduction so the
  entry's "unconfirmed" status is backed by a second sighting rather than one.
