# F-F08 — `checkAdmission` has no production caller, and the module header describes a second gate that does not exist

- **Stream:** F Simplifiable · **Severity:** LOW (security-adjacent: a stale description of a gate) · **Confidence:** CONFIRMED (verified)
- **Area:** `apps/web/src/server/admission.ts:206` (`checkAdmission`, only referenced by `admission.int.test.ts:6,91,254-289`); header `:13-17` says the code is "asked twice — advisorily by the `/signup` form"; `apps/web/src/app/(front)/signup/page.tsx:36-42` says the page cannot import `@/server/*` and "Validation stays … in `server/admission.ts`, reached from `recordSignIn`".
- **What is wrong:** the advisory path was never wired; ~29 lines of gate logic and ~40 lines of tests exist to test each other, and the authoritative-gate module's header describes a check that is not there. Not a security hole — `redeemAdmission` (the real gate, `users.ts:231`) is wired and tested including its concurrency case (`admission.int.test.ts:210-250`).
- **Suggested fix:** delete `checkAdmission` and its `describe` block; rewrite `:13-17` to "asked once, by `recordSignIn`".
- **Scope of the fix:** 2 files. Check subset: `admission.test.ts`, `admission.int.test.ts`, `users.int.test.ts`.
- **Cross-reference:** ADR-025.
- **Do not:** wire the advisory path into the form to make the comment true — `signup/page.tsx:36-40` records why the lint wall forbids it.
