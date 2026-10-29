### KI-2026-10-28-b — An MCP tool whose own code throws is not logged, and its raw error message goes back to the client — RESOLVED

- **Severity:** correctness (security, low to medium): an information leak, plus server faults
  that nobody sees. The message of whatever threw (a database driver's text, a stack-shaped
  string) goes to the connected client, and so into a model's context and a chat transcript,
  while our logs record nothing.
- **Area:** `apps/web/src/server/mcp/dispatch.ts` (`callTool`) and
  `apps/web/src/server/mcp/server.ts` (`buildServer`'s `tools/call` handler, `reportMcpError`);
  the SDK is `@modelcontextprotocol/server` 2.4.0 (M55 part 10).
- **Symptom / What happens:** when code inside `callTool` throws, outside the v1 handler's own
  error envelope, for example `forgetKey` (the idempotency key a replayed answer no longer
  holds), `readableSavedDay` (in `stillTrue`) or a tool's `tool.answer` shaping v1's answer, the
  exception leaves the `tools/call` handler. The SDK turns a handler exception into a JSON-RPC
  error reply carrying the exception's message, and does not call `onerror` for it (the SDK's
  bundled `src-DdvbAHrR.mjs:6563`, as read in the M55 close review). So `reportMcpError` never
  runs, nothing reaches `console.error`, and the client sees the raw message. A failure inside
  the v1 handler itself is not affected: `route()` answers it with the v1 error envelope, which
  `callTool` turns into a tool error.
- **Why not fixed here:** found while closing M55 (part 0, PR 613), which is prose only.
  Mitchell chose on 2026-10-28 to record it rather than fix it in M55. **Intended fix:** wrap the
  body of the `tools/call` handler in `buildServer` in a `try` / `catch` that logs the error
  (`console.error`, with the tool name and no input) and answers a generic tool error
  (`isError: true`, "Something went wrong on our side."), with an integration test that makes
  `tool.answer` throw and asserts both the log and that the message does not reach the client,
  seen red first.
- **Cross-reference:** ADR-083 §8 (a v1 refusal becomes a tool error with the envelope's
  message); `reportMcpError` added by M55 part 10 (PR 624); M55's milestone file, *Retro →
  Leftovers*.
- **First noted:** 2026-10-28, the M55 gate close. The defect predates part 10: on SDK 1.32.2 a
  handler exception was also answered in-band with its message
  (`dist/esm/shared/protocol.js:427`, `message: error.message ?? 'Internal error'`) and reached
  `onerror` only if sending that reply failed (`:443`).
- **Reproduced before fixing:** a test in `apps/web/src/app/api/mcp/route.int.test.ts` makes
  `whoami`'s `tool.answer` throw `relation "oauth_grants_secret" does not exist` and calls it
  through the real `POST /api/mcp`, on both revisions. Against the unmodified handler both failed:
  `AssertionError: expected '{"jsonrpc":"2.0","id":1,"error":{"cod…' not to contain
  'oauth_grants_secret'`, the reply being
  `{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"relation \"oauth_grants_secret\" does not exist"}}`.
- **Fix (2026-10-28):** the intended one. `buildServer`'s `tools/call` handler in
  `apps/web/src/server/mcp/server.ts` wraps `callTool` in a `try` / `catch` that logs
  `console.error("mcp tool threw", { tool, error })`, with no input, and answers
  `{ isError: true }` with "Something went wrong on our side." **Proof:** the same two tests pass
  (`Tests 20 passed (20)` for the file), asserting the exact log call, the generic tool error,
  and that the thrown text is nowhere in the reply. **Resolved:** 2026-10-28.
