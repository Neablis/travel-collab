# F-D08 — `ci.yml`'s header and `.coderabbit.yaml`'s first line argue from constraints that stopped binding

- **Stream:** D Infra · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `.github/workflows/ci.yml:3-10,94-100` (reasons from a private-repo 2,000-minute cap) vs `docs/guidelines/ci-cost-and-capacity.md:3-7` (the repo went public 2026-08-31; minutes are unlimited); `.coderabbit.yaml:6` ("It stays a required check") contradicted by its own `:10-17` correction.
- **What is wrong:** the next person tuning CI reads the first ten lines and optimises for a budget that no longer exists; the levers themselves are still right (wall clock and signal), so only the framing needs fixing.
- **Suggested fix:** two-line comment edits pointing at the status block in `ci-cost-and-capacity.md`; delete or reword `.coderabbit.yaml:6`.
- **Scope of the fix:** two files; workflow prose only. Check subset: none.
- **Cross-reference:** F-E08 (the same pattern in guidelines), 2026-08-28 review §4.
