# F-F02 — `offeredToolNamesFor` / `AskToolSet` is a second, production-unused statement of the tool sets, tested against its own implementation

- **Stream:** F Simplifiable · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `apps/web/src/server/ai/handleAskRequest.ts:92-124` (type, function, 20-line docblock), `:141,145` (the only production callers — the `ASK_MINIMUM_ROLE`/`APPLY_MINIMUM_ROLE` constants), `:480-484` (the runtime builds `tools` from the three builders and measures `Object.keys(tools)`); `ask/route.int.test.ts:337` asserts `offeredToolNamesFor("page")` equals `[...READ_TOOL_NAMES, ...PAGE_TOOL_NAMES]`, which restates `:110-111`. Test-only defaults on `instructionsFor` at `:946-947` (production caller `:569` passes all four args).
- **What is wrong:** two ways of saying which tools a turn gets; only one executes. The test cannot fail for any reason the implementation does not share.
- **Suggested fix:** `ASK_MINIMUM_ROLE = minimumRoleFor(READ_TOOL_NAMES)`, `APPLY_MINIMUM_ROLE = minimumRoleFor([...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES])`; delete `AskToolSet`/`offeredToolNamesFor`; repoint the disjointness assertions (`route.int.test.ts:331-340`) at `WRITE_TOOL_NAMES`/`PAGE_TOOL_NAMES` from the builders and at the recorder's `offeredTools` (`handleAskRequest.ts:515`); drop the defaults at `:946-947`. Update the four comment references (`apiClient.ts:777`, `apiClient.test.ts:575`, `askIntent.ts:30`, `handleAskRequest.ts:8`). ~35 → ~5 lines.
- **Scope of the fix:** one file + one int test. No contracts. Check subset: `ask/route.int.test.ts` (needs DB).
- **Test that preserves behaviour:** `ask/route.int.test.ts:262,349,577,592` (tool sets by role/scope, measured from the recorder), `:312-327` (`minimumRoleFor` table).
- **Cross-reference:** ADR-033 decision 2 (keep `minimumRoleFor` and the `:484-486` tripwire), F-E07.
- **Do not:** touch `minimumRoleFor` or the tripwire.
