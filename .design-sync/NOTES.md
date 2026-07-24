# design-sync notes for travel-collab

## Repo shape
- No standalone design-system package and no Storybook. The UI kit is
  `apps/web/src/components/ui` inside the Next.js app (`web` package). Synced
  via synth-entry mode (`cfg.srcDir`), not a `dist/` build.
- Scope is deliberately `components/ui` only — `components/board`,
  `components/trip`, `components/lenses` are feature composites coupled to
  trip/domain data, not general-purpose design-system components.

## Tailwind v4 CSS — must be compiled before every build
`apps/web/src/app/globals.css` is Tailwind v4 source (`@import "tailwindcss"`
+ `@theme`), not compiled CSS. design-sync's `cssEntry` is appended
**verbatim** — it does not run PostCSS/Tailwind. So before every
`package-build.mjs` run:

```sh
cd apps/web && node scripts/design-sync-tailwind.mjs
```

(This is `cfg.buildCmd` — the driver re-runs it automatically on re-sync.)
It runs `@tailwindcss/postcss` over `globals.css` (same plugin the app's own
`postcss.config.mjs` uses) and writes `apps/web/.ds-compiled.css`, which
`cfg.cssEntry` points at. It also appends a `:root` block bridging
`--font-next-{display,sans,mono}` to real font-family names (see below).
`scripts/design-sync-tailwind.mjs` is committed (repo tooling, like
`scripts/db-reset.mjs`); `.ds-compiled.css` is a generated artifact —
gitignored, regenerate don't hand-edit.

Postcss isn't hoisted into `apps/web/node_modules` under pnpm's strict
linking — the script imports it via an absolute path into
`node_modules/.pnpm/postcss@<version>/node_modules/postcss/lib/postcss.mjs`
at the repo root. If pnpm dedupes to a different postcss version, update that
path (`find node_modules/.pnpm -maxdepth 1 -iname "postcss@*"` at repo root).

## Fonts — next/font/google, no static files in the repo
The app loads Bricolage Grotesque, IBM Plex Sans, and IBM Plex Mono via
`next/font/google` in `apps/web/src/app/layout.tsx`, which generates hashed
local family names + inlined `@font-face` at build/runtime — nothing static
for the sync to discover. `--font-next-display/-sans/-mono` in the compiled
CSS are otherwise undefined outside the Next.js app.

Fix: `.design-sync/fonts-src/` holds real self-hosted copies (SIL OFL, latin
subset, the weights `layout.tsx` requests: Bricolage 500/600, IBM Plex Sans
400/500/600, IBM Plex Mono 400/500), downloaded 2026-07-19 from Google Fonts'
own CDN (fonts.gstatic.com) via the css2 API. `cfg.extraFonts` points at
`fonts-src/fonts.css`; `.ds-tw-compile.mjs` bridges the `--font-next-*`
variables to the real family names. User approved self-hosting the real fonts
over fallback substitutes.

**Re-sync risk**: if `layout.tsx` changes font families/weights, this
directory and the bridge in `.ds-tw-compile.mjs` go stale silently — nothing
will flag a mismatch, it'll just render the old fonts. Check `layout.tsx`
against `.design-sync/fonts-src/fonts.css` on any design-related re-sync.

## Package resolution
No `node_modules/web` symlink exists (the `web` app isn't a dependency of
anything), so `PKG_DIR` can't resolve via `--node-modules` + `cfg.pkg` alone.
Build with `--entry apps/web/src/.ds-entry-marker.ts` (a placeholder path
that doesn't need to exist) so the script's package.json walk-up lands on
`apps/web/package.json`. This intentionally trips `[NO_DIST]` (soft,
non-fatal) before falling into synth-entry mode from `cfg.srcDir`.

## Known limitation: TR, TH, TD are not synced
`table.tsx` exports `TR`, `TH`, `TD` alongside `Table`/`THead`/`TBody`/`TFoot`,
but they don't make it into the DS: `isComponentName`'s all-caps heuristic
(meant to filter enum-style constants like `STATUS`) matches any name whose
letters after the first are all uppercase, so `TR`/`TH`/`TD` read as
constants. Tried pinning them via `cfg.componentSrcMap` — doesn't work here:
this repo has no real `.d.ts` tree, so `resolvePackage`'s synth-entry
fallback (`deriveComponentsFromSrc`, which finds all 33 real exports
including these three) only runs when the pre-override name set is *empty*;
adding the 3 names via `componentSrcMap` makes it non-empty and the fallback
never fires, and the same `isComponentName` filter is re-applied
unconditionally in `package-build.mjs`'s main body afterward regardless of
provenance — so there's no config path that keeps them. Accepted as a gap:
`Table`'s own preview composes real rows/cells, so the pattern is visible
even without standalone `TR`/`TH`/`TD` cards. Would need a `dts.mjs` fork to
fix (not done — low value for 3 structural wrapper components).

## Scope
~22 components / ~31 exports in `components/ui` (Button, Card, Badge,
Dialog, Tabs, TabsList/Content/Trigger, Table + T-subcomponents, Popover,
Sheet, Input, Textarea, Label, FormField, Heading, Text, DataText, Banner,
EmptyState, Panel, PageContainer, SegmentedControl, TabStrip, NativeSelect,
BudgetMeter, DialogFooter). User chose to author rich previews for all of
them rather than floor cards.

`budget-meter.tsx` imports `formatAmount` from
`@/components/lenses/formatMoney` (outside the synced `components/ui` scope)
— a small pure formatting function, resolves fine via `cfg.tsconfig`'s `@/*`
path alias, no domain/server coupling.

## Re-sync risks
- Tailwind CSS must be recompiled (`.ds-tw-compile.mjs`) before every build —
  a stale `.ds-compiled.css` silently ships old styles.
- Font bridge (above) can go stale if `layout.tsx`'s fonts change.
- `.design-sync/fonts-src/` fonts were fetched from Google's live CDN at
  sync time — not vendored from a repo-committed source, so they won't
  reflect any future manual font changes automatically.
