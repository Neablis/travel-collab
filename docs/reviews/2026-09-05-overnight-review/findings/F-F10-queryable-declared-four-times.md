# F-F10 — `Queryable` is declared four times because `db/client.ts` does not export it

- **Stream:** F Simplifiable · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** identical `type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0]` at `apps/web/src/server/projections.ts:10`, `eventStore.ts:12`, `savedDayAdds.ts:8` (with an apology at `:5-7`), `access/members.ts:7`; `db/client.ts:7-8` exports only `db` and `Db`.
- **Suggested fix:** export the type from `db/client.ts`, delete four copies and the apology. ~9 lines.
- **Scope of the fix:** 5 files. Check subset: `pnpm --filter web typecheck`.
