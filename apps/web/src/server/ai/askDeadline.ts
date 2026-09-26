// The ask route's time budget (KI-2026-09-26-s): the wall it runs against, and
// the two deadlines a turn is held to under it. A module of its own so the
// route, the handler and the test that ties them together share one number
// without the test importing the handler's database graph.

/**
 * **The ask route's wall, in seconds** — the value `route.ts` exports as
 * `maxDuration`. Next.js reads that export statically, so it has to be a
 * literal there; this is the same number for code to derive from, and
 * `askDeadline.test.ts` asserts the two agree.
 *
 * 300 is what the deployment already enforced without saying so: on
 * 2026-09-26 a page turn died at `Task timed out after 300 seconds`, wrote no
 * `ai.ask` record, and delivered nothing it had drafted (KI-2026-09-26-s).
 */
export const ASK_MAX_DURATION_SECONDS = 300;

/**
 * **After this, the turn takes no new tool step** — it is given one last step
 * with no tools, to say what it did, and stops. Half the wall: long enough for
 * every turn shape this route has measured (a planning turn's worst live run
 * was ~90s), and it leaves the other half for a step already in flight to
 * finish, which is the one this cannot interrupt.
 */
export const ASK_STEP_DEADLINE_MS = ASK_MAX_DURATION_SECONDS * 1000 * 0.5;

/**
 * **After this, the turn is ABORTED**, whatever it is doing — 60 seconds under
 * the wall. What it had drafted still goes out (the abort part carries it),
 * and the `ai.ask` record is written with `outcome: "abort"` and the deadline
 * as its cause. The margin is for exactly those two writes plus the ledger
 * settlement: a turn the platform kills first writes none of them.
 */
export const ASK_HARD_DEADLINE_MS = ASK_MAX_DURATION_SECONDS * 1000 - 60_000;

/** What the deadline aborts a turn with — the cause the `ai.ask` record carries. */
export class AskDeadlineError extends Error {
  constructor(ms: number) {
    super(`The turn reached its ${Math.round(ms / 1000)}s deadline and was stopped.`);
    // `TimeoutError`, the name `AbortSignal.timeout` gives its own reason: the
    // AI SDK reads it as an abort (`isAbortError`) and ends the stream with an
    // `abort` part — which is what carries the drafted inserts out — rather
    // than as a provider failure. The record's `cause.message` says which
    // timeout it was.
    this.name = "TimeoutError";
  }
}

/** Test seam: the two deadlines, shortened. Production never passes it. */
export interface AskDeadlines {
  stepMs: number;
  hardMs: number;
}
