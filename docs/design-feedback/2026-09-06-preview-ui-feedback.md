# UI feedback round — 2026-09-06 (live preview)

**Status: open, collecting.** This file exists so Mitchell has a preview
deployment to comment on and a place for those comments to land. Nothing has
been triaged or fixed yet.

## Why this PR exists

`main` had no open PR on 2026-09-06, so there was no preview deployment and no
Vercel toolbar to leave UI comments through. Production
(`caesura.today` / `travel-collab-three.vercel.app`) does **not** load the
toolbar — it is preview-only, which is the whole point of
`docs/guidelines/environments-and-deploys.md`'s "what a preview shows that a
local production build cannot". So this branch carries a prose-only change off
the current `main` (`af37b6b`, PR #148) purely to open a preview at the exact
code Mitchell is looking at.

The branch deliberately contains **no code**. That keeps the preview an honest
picture of `main`: anything reported here is a real defect in shipped code, not
an artefact of a half-finished branch.

## The surface under review

`main` at `af37b6b` — which is M14's widget framework plus the M16 mobile work
merged in #143, #146, #147, and #148. The most recently built surfaces, and so
the likeliest place for new defects:

- The phone (412×856): the scoped tab bar from SPEC §22, and the `Ask` pill and
  bottom sheet from SPEC §23 across all four in-trip screens.
- The Notebook: PageDoc widgets, the three insert surfaces, the preset picker.
- Desktop trip board, Map and Calendar lenses, which #147 touched while
  clearing seven known issues.

`apps/web/src/lib/preview-registry.ts` remains the authoritative list of
deliberately unbuilt surfaces. Anything in it is known-absent, not a bug.

## How to leave feedback

Open the preview URL in the PR (Vercel's bot comments it, and it is also on the
"Preview URL walked" line below once confirmed) and use the Vercel toolbar's
comment tool. Each comment anchors to the element and route it was written on,
which is what makes this pass cheap to act on: the selector and React component
tree come back with the thread and map straight to a file, no guessing. That is
how `2026-07-12-pr11-vercel-ui-comments.md` and `2026-08-30-design-pass-preview.md`
were both worked.

The preview is behind Vercel Authentication. Signed in to the `neablis-projects`
account it opens directly; from anywhere else it needs a `?_vercel_share=` link
(23-hour lifetime), per `environments-and-deploys.md` → "Testing against a
preview deployment".

## How the comments get collected

Threads are pulled with the Vercel MCP's `list_toolbar_threads`, transcribed
verbatim into the table below with their selector and component tree, and only
then triaged. Verbatim first, analysis second — the two earlier passes both
found that a paraphrased comment loses the detail that identifies the element.

Each finding then ends in exactly one of three states, and none of them is
silence:

- **Fixed here** — if it is small and local, with the fix on this branch, which
  makes the branch Tier 2 or Tier 3 and no longer prose-only. See `AGENTS.md` →
  Definition of Done.
- **Filed** — a `docs/known-issues/open/` entry, named in the PR's Known issues
  section. A defect found and consciously left is fine; found and unrecorded is
  not.
- **Answered** — not a defect, with the reason recorded next to it.

## Findings

_Empty until the comments are in. One row per toolbar thread, in the order left._

| # | Route / surface | Viewport | What's wrong | Outcome |
| - | --------------- | -------- | ------------ | ------- |
| | | | | |
