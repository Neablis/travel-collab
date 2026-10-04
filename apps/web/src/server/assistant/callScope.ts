// **Which tool call is running, for code that cannot be told** (M31 Phase 1).
//
// The ledger's `reachedProposal` asks whether something a call collected made
// it into the proposal the user saw. The buffer is where collection happens,
// and a tool's `invoke` hands it an intent without knowing its own call id —
// the SDK passes `toolCallId` to `execute`, one frame above, and nowhere else.
//
// Threading the id through every write tool's signature would widen 20-odd
// definitions for a measurement. Counting the buffer before and after a call
// would be wrong the first time two calls in one step ran concurrently, which
// the SDK does. An async-local scope opened by `measured()` (registry.ts) is
// exact under concurrency and changes no tool: the buffer reads it, and code
// outside a call reads null.
import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<string>();

/** Runs `run` with `callId` as the current tool call. */
export function runInCall<T>(callId: string | null, run: () => Promise<T>): Promise<T> {
  return callId === null ? run() : scope.run(callId, run);
}

/** The tool call this code is running inside, or null outside any call. */
export function currentCallId(): string | null {
  return scope.getStore() ?? null;
}
