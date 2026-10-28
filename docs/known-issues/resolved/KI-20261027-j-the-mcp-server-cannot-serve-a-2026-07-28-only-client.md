### KI-2026-10-27-j — The MCP server cannot serve a client that speaks only MCP 2026-07-28 — RESOLVED

- **Severity:** compatibility, medium. Claude negotiates down today, so no known client fails yet.
- **Area:** `apps/web/src/app/api/mcp/route.ts` and the pinned `@modelcontextprotocol/sdk` 1.32.2
  (`apps/web/package.json`).
- **Symptom / What happens:** the SDK targets `2025-11-25`. Its transport answers a request
  carrying `MCP-Protocol-Version: 2026-07-28` with a 400, and `initialize` negotiates down to
  `2025-11-25`. A client that will not negotiate down cannot connect. `Mcp-Method` / `Mcp-Name`
  are ignored, which is harmless, and `CacheableResult` is not offered.
- **Why not fixed here:** no SDK release targeting 2026-07-28 was pinned for M55 part 4; ADR-083
  §8 (amendment L) records the gap.
- **Fix path / Tripwire:** upgrade the SDK once a release lists `2026-07-28` in
  `SUPPORTED_PROTOCOL_VERSIONS`, then add a `route.int.test.ts` case sending that version header.
  If Claude's connector starts failing at `initialize` with a 400, this is the first place to look.
- **Cross-reference:** ADR-083 §8; M55 part 4, PR 617.
- **First noted:** 2026-10-27, M55 part 4 build.
- **Fix (M55 part 10, PR 624, merged 2026-10-28 in `acb7f93`):** `/api/mcp` moved from
  `@modelcontextprotocol/sdk` 1.32.2 to `@modelcontextprotocol/server` 2.4.0, and one handler
  (`createMcpHandler(factory, { legacy: "stateless" })`) serves MCP 2026-07-28 with its required
  `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers and a `CacheableResult` on
  `tools/list`, and still serves the 2025-11-25 handshake (answered as one-event SSE). ADR-083 §8
  records it under amendment L.
- **Proof:** PR 624's red-first table: on SDK 1.32.2, *2026-07-28 lists the tools, with a short
  private cache life* failed `AssertionError: expected 400 to be 200` (*Bad Request: Unsupported
  protocol version: 2026-07-28*), and *Mcp-Name matches, mismatch refused* failed the same way;
  both pass on 2.4.0 (`app/api/mcp/route.int.test.ts:165,176`; 18 of 18 locally at `5b69f63`).
  CI `test / integration` 122592887135 and `ci-ok` 122595146153 are green on `5b69f63` (Actions
  run 40620414814). Mitchell's production walk, 2026-10-28, confirmed Claude.ai's connector still
  works on the 2025 leg after the merge.
