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

The preview, built from `4728239` and confirmed READY on 2026-09-06:

    https://travel-collab-git-claude-vercel-preview-6497b8-neablis-projects.vercel.app

Open it and use the Vercel toolbar's comment tool. Each comment anchors to the
element and route it was written on, which is what makes this pass cheap to act on: the selector and React component
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

One row per toolbar thread, in the order left. Detail below the table.

| # | Route / surface | Viewport | What's wrong | Outcome |
| - | --------------- | -------- | ------------ | ------- |
| 1 | `/signin` — dev-login submit | 1728×836 | Dev-login button is the faintest control on a screen where it is the only one that works | **Open — awaiting decision** |

### 1. `/signin` — "Sign in with dev login" prominence

> "Make the \"Sign in with dev login\" button more pronounced"

- Thread: `cBvDTW4vOces` (neablis, 2026-09-06)
- Route: `/signin` ("Sign in — Caesura"), Chrome 151 on macOS, 1728×836 @2x
- Selector: `body > div.flex > main.grid > div.flex > div.rounded-md > form.flex > button.inline-flex`
- Component tree: inside `AuthScreen` (`mode="signin" devLoginEnabled googleAvailable`) →
  the `devLoginEnabled` `<form className="flex flex-col gap-2 border-t border-hairline pt-3.5">`
  → its submit `Button`, captured as `variant="ghost" disabled`.
- Maps to: `apps/web/src/components/front/AuthScreen.tsx:309`.

**Why the contrast is as stark as it is.** The button directly above it —
"Continue with Google" — is `variant="secondary"` with
`className="h-11.5 w-full text-md font-semibold"`. The dev-login button is
`variant="ghost"` with no sizing classes at all. So the hierarchy is not
incidental; it is two deliberate and opposite styling decisions stacked in the
same card.

**And the hierarchy is right in general, but backwards on a preview.** Ghost is
the correct weight for a control whose own `FormField` hint reads "Preview and
local only" — it should not compete with Google in production. But this surface
*is* a preview, where dev login is typically the only path that actually
completes, so the one button a reviewer needs is the quietest thing on screen.
Any fix should key off the environment rather than just darkening the button
everywhere.

**On the captured `disabled`.** That is `disabled={!hydrated}`, not a defect —
it is the fix for finding 1 of the 2026-08-30 pass ("Enter appeared to do
nothing"), which deliberately shows a disabled control pre-hydration rather than
failing silently. The toolbar snapshotted before hydration. Noted so it is not
re-reported as a bug.
