### KI-2026-10-27-e — The MCP server cannot serve a client that speaks only MCP 2026-07-28

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
