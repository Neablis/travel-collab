# F-D05 — `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` is inert and stale; the supply-chain control it implies is not on

- **Stream:** D Infra · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `pnpm-workspace.yaml:9-12` (excludes `@ai-sdk/gateway@4.0.26`, `@ai-sdk/provider-utils@5.0.12`, `ai@7.0.34`); no `minimumReleaseAge` anywhere in the repo and no `.npmrc`; the three versions equal the locked ones (`pnpm-lock.yaml:342,348,3111`); introduced in `7de5d56` (#91, 2026-08-30).
- **What is wrong:** on 2026-08-30 those releases were younger than a machine-level `minimumReleaseAge`, so the installer bypassed them and the bypass was committed. In-repo it does nothing — but it advertises a control (a release-age quarantine against supply-chain compromise) that is not actually configured for the project.
- **Suggested fix:** set `minimumReleaseAge: 1440` (24h; pnpm 10.28 supports it) in `pnpm-workspace.yaml` and delete the three exclusions — a supply-chain control for free — or delete the block so the file stops implying one.
- **Scope of the fix:** one file. Check subset: `pnpm install --frozen-lockfile` still succeeds.
- **Cross-reference:** the Dependabot alert count on the default branch (17 vulnerabilities, 9 high, per the push output during this review) — see F-D06.
