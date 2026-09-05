# F-F03 — The two AI handlers duplicate the body-reading ritual and the demo refusal verbatim

- **Stream:** F Simplifiable · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `apps/web/src/server/ai/handleAskRequest.ts:296-305` and `:846-855` (read text → `Blob` size → `JSON.parse` → `safeParse` → `badRequest(issues[0])`, byte-identical); demo refusal `:268-273` and `:831-836`. No `readJsonBody`/`readBody` helper exists anywhere in `apps/web/src`.
- **Suggested fix:** the same `readBody(request, schema)` helper F-E04 proposes for the plain routes — this is its best-tested instance (`ask/route.int.test.ts:950` 128 KB, `:961`, `:985`, `:280`; `ask/apply/route.int.test.ts:342` malformed JSON, `:117` demo before guard) — plus a `demoRefusal()` constant. Do F-E04 and F-F03 as one change.
- **Scope of the fix:** `handleAskRequest.ts`, new `server/readBody.ts`. Check subset: both ask int suites.
- **Do not:** move the `MAX_ASK_BODY_BYTES` check (`:295-297`) after `JSON.parse` — the ordering is the point.
