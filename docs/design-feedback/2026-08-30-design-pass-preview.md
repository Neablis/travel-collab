# Design pass — 2026-08-30 (live preview)

Scratch pad for a design pass run by hand against this PR's Vercel preview.
The PR exists so there is a preview URL to click through; this file is where
the findings land as they are found.

Nothing here is triaged yet. Once the pass is done, each item either becomes a
fix in this branch, a known-issue entry under `docs/known-issues/open/`, or is
dropped with a reason.

## How this pass is being run

- Surface: the Vercel preview built from this PR (not local `pnpm dev`).
- Data: whatever the preview environment seeds.
- Viewports to cover: 1440×900, 1100×800, 402×844.

`apps/web/src/lib/preview-registry.ts` is the authoritative list of
deliberately unbuilt surfaces — a `Preview · Mn` chip is a designed shell
working as intended, not a finding.

## Findings

_(none recorded yet)_

| # | Route / surface | Viewport | What's wrong | Severity |
| - | --------------- | -------- | ------------ | -------- |

## Disposition

| # | Outcome |
| - | ------- |
