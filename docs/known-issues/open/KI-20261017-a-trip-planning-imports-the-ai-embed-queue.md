### KI-2026-10-17-a — Trip Planning imports the AI module's embed queue

- **Severity:** architecture. Nothing is wrong at runtime; the module map's direction is.
- **Area:** `apps/web/src/server/commands.ts` (`appendAndProject`, the `./ai/queue` import) and
  `apps/web/src/server/ai/queue.ts` (`enqueueDayChunksInTransaction`).
- **Symptom:** every trip write calls the RAG embed queue from inside Planning's command funnel,
  so Planning knows about embeddings, while `server/ai/**` imports `@/server/commands` in about
  20 places. That is a root↔subfolder cycle of the kind KI-2026-09-23-b says the architecture
  wall cannot see, in the module the map guards most.
- **Why not fixed here:** the cost half of the audit finding was fixed on 2026-10-17 (one
  multi-row upsert per write; the sweep skips the provider for a day whose text did not change).
  What is left is the dependency direction. That needs a design call, so it was not part of the
  audit's fix branch.
- **Fix direction (planned, Mitchell 2026-10-17):** invert it with a hook Planning owns and AI
  registers on:
  1. `commands.ts` exports `onTripWritten(listener)`, where a listener is
     `(tx, { tripId, detail }) => Promise<void>`. `appendAndProject` calls every registered
     listener inside the command's transaction, after `projectAndHistory`. Inside the
     transaction, not after commit: `enqueueDayChunksInTransaction`'s two properties (no phantom
     rows on a rollback; a savepoint so a failure never breaks the trip write) depend on it.
  2. `ai/queue.ts` (or one `ai/register.ts`) registers the enqueue. `commands.ts` drops the
     `./ai/queue` import, so the import runs AI → Planning only.
  3. The trap is a listener that never registers, which would make embed-on-write silently stop.
     Register from one composition point every server entry loads (`instrumentation.ts`'s
     `register`, or a module the API routes import), and add a test that asserts the
     composition registered the enqueue listener. Keep `sweep.int.test.ts`'s "trip commands
     enqueue the trip's days" test green throughout: it is the behaviour proof.
     Verify before relying on it: a registry is module state, and Next can give route bundles
     and `instrumentation.ts` separate module instances. Prove on a preview deployment that a
     trip write through `/api/trips/[tripId]/commands` queues its days. If it does not, pass the
     listener in explicitly from each entry point instead of registering it.
  4. Add a `.dependency-cruiser.cjs` rule forbidding `server/*.ts` → `server/ai/**`, so the
     direction cannot come back. `commands.ts` is not the only root importer: `savedDays.ts`
     (the playbook enqueue), `savedDayPins.ts` and `savedDayPinBackfill.ts` import `server/ai/`
     too, so either route them through the same hook or start the rule with those named as
     known exceptions.
- **Cross-reference:** audit `docs/reviews/2026-10-16-codebase-and-agent-architecture-audit.md`
  §5.2; KI-2026-09-23-b (server root hides module cycles); ADR-075 (plan retrieval on pgvector).
- **First noted:** 2026-10-16 audit; filed 2026-10-17.
