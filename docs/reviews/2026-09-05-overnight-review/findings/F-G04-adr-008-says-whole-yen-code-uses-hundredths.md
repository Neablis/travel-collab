# F-G04 — ADR-008 says "whole yen for JPY"; every writer and reader treats `amountMinor` as hundredths, and the board and notebook formatters disagree on JPY decimals

- **Stream:** G Broken functionality · **Severity:** LOW · **Confidence:** CONFIRMED (node-checked)
- **Area:** `docs/architecture/ADR-008-money-representation.md:39-40`; `apps/web/src/components/board/MoneyInput.tsx:21` (`Number(trimmed) * 100`); `apps/web/src/server/ai/planningTools.ts:21` (model told "multiply a decimal amount by 100"); `apps/web/src/components/lenses/formatMoney.ts:14` (`/ 100` → `¥5,000.00`); `packages/pages/src/format.ts:2` (`Intl … currency`, which applies JPY's zero fraction digits → `¥5,000` for the same 500000); `formatMoney.test.ts:35` pins `["JPY","¥1.00"]`.
- **What is wrong:** no stored value is numerically wrong (consistently ×100 in, ÷100 out), but the ADR is false as written, yen render with two fake decimals on the board, and a notebook `cost` widget shows `¥5,000` beside a board showing `¥5,000.00`. Verified: `Intl(JPY).format(500000/100)` → `¥5,000`; `(5000/100)` → `¥50`.
- **Suggested fix:** cheapest — amend ADR-008 to "hundredths for every currency" and make `packages/pages/src/format.ts` pass `minimumFractionDigits: 2` so both surfaces agree. Currency-aware minor units would touch input, prompt, both formatters and the contract; not worth it until a non-decimal currency is a real use case.
- **Scope of the fix:** ADR + one formatter (+ its test). Check subset: `pnpm --filter @tc/pages test`, `formatMoney.test.ts`.
- **Cross-reference:** ADR-008, KI-056 (resolved).
