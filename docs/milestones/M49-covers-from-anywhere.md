# M49 — A cover can come from anywhere, and be framed where you want it

**Status:** **Closed 2026-10-25, gate 9 of 9**, by `pnpm milestone close M49 --confirm` on part 0 (PR 581). **Scoped 2026-10-25 with Mitchell.** Decisions 4–10 were answered
as recommended and decision 2 was confirmed at scoping (2026-10-25). The design is ADR-081, and the
plan is `docs/plans/2026-10-25-M49-covers-from-anywhere.md` (deleted at gate close). Proposed
2026-10-12 and minted on Mitchell's ask (see `docs/milestones/README.md`, *2026-10-12 — reordered
and minted*). It waited for M51 and then M52, both closed.

## Why this exists

M37 gave trips and playbook days covers, but only from Unsplash, and only from the app:

- **The public API cannot touch a cover.** `trips/[tripId]/cover` and its search are marked
  `PLANNED("Undecided …")` in `apps/web/src/server/public-api/exposure.ts`. Mitchell, 2026-10-12:
  *"Allowing the api to set a header image so i can use the api to find and add images to trips
  in the future."* The finding happens outside Caesura; the API only has to accept the result.
- **A cover can only be an Unsplash photo.** `trip_covers` requires an Unsplash id and a
  photographer (`apps/web/src/server/db/schema.ts`), the server accepts only
  `images.unsplash.com`, and the page's CSP admits no other image host (`apps/web/next.config.ts`).
- **A cover is always centre-cropped.** The trip page's band fades over its bottom third, so a
  photo whose subject sits low loses it. Mitchell, 2026-10-10: *"i want to do the adjusted photo
  crop like notion option later"*.

Candidates absorbed (each deleted by this gate):
- *Reposition a cover: drag the photo to choose what the band shows* (2026-10-10)

## Decisions

**Answered by Mitchell, 2026-10-12:**

1. **A cover can come from any image URL**, not only Unsplash.
2. **A URL cover is referenced, not uploaded and stored.** Caesura keeps the URL and shows the image
   from it, and never copies the image into its own storage. **Confirmed at scoping, 2026-10-25:**
   the proxy (decision 4) caches at the CDN and writes nothing to blob storage.
3. **Reposition ships in both places**: as a field on the API, and as a drag in the UI.

**Answered by Mitchell at scoping, 2026-10-25, each as recommended:**

4. **A browser loads a URL cover through a pass-through route on Caesura's own origin.** The route
   fetches the image and streams it back with CDN cache headers, writing nothing to storage. The
   CSP's `img-src` stays as it is, and a viewer's IP and referrer never reach a third-party host.
   The route serves only URLs Caesura itself signed when it serialized a cover, so it is not an
   open proxy (ADR-081).
5. **Setting a URL cover checks it.** `https` only. One fetch at set time must answer `image/*`
   under a size cap. An SSRF guard refuses private, loopback and link-local addresses on every
   hop and allows at most 3 redirects. A URL that fails is a 422 with the new error code
   `cover-url-rejected` and a reason, and nothing is saved. The proxy applies the same guard on
   every fetch.
6. **`TripCover` becomes a union on `source`.** It is either `"unsplash"` (today's fields) or
   `"url"` (`url`, optional `alt`, optional `credit: { name, url? }`), and both carry `position`.
   Migration `0068` makes the Unsplash columns nullable and adds `source`, `url`, `credit_name`,
   `credit_url` and `position` to `trip_covers` and `saved_day_covers`. Existing rows read as
   `source: "unsplash"`, `position: 50`. It is recorded in a `docs/contracts/CHANGELOG.md` entry, as
   public API **1.28.0** (part 1, since `TripCover` is already in the published document). The
   cover endpoint (decision 8) and its error code follow as the next minor (part 3). Unsplash's attribution rules keep applying to Unsplash covers only.
7. **A dead link falls back** to the designed no-cover state when the image fails to load
   (`onError` on `CoverImage`, which today has none, so a broken Unsplash image is fixed too).
   Nothing re-checks URLs in the background.
8. **The API surface** is `GET`, `PUT` and `DELETE /v1/trips/{tripId}/cover`, with `PUT` taking
   `{ url, alt?, credit?, position? }`, and `PATCH` taking `{ position }` alone. The token needs
   `trips:write`, and an editor is the minimum role, as in the app. **No Unsplash search on the
   API**: `exposure.ts` marks the search route `never`. Playbook-day covers stay off the API.
9. **`position` is one vertical value**, `0–100`, default `50` (today's crop). It renders as
   `object-position: center <y>%` in `CoverImage`, so the trip band, the Home card, the Home hero
   (`NextTripHero`) and the playbook day all follow. A new photo resets it to `50`. Playbook-day
   covers carry the column too, so the shared row types line up. Horizontal position is left out
   until a surface needs it.
10. **The control is Notion's pattern on the band.** An editor hovering the band sees *Reposition*
    beside *Change cover*. Clicking it shows *Drag image to reposition*, with a grab cursor. A mouse
    or touch drag moves the photo vertically, live. `↑`/`↓` move it 1%, and with `Shift` 10%.
    *Save position* (or `Enter`) saves it, and *Cancel* (or `Esc`) reverts. It is the same control
    for every cover, so a URL cover can be repositioned in the UI too, though only the API can set
    one. The band is desktop-only today, so a phone has no reposition.

    **Amended 2026-10-25 by Mitchell**, to simplify the UI: *"remove the add, remove, change buttons
    for cover and make a more hidden experience, maybe a on hover to show that clicking lets you
    add/change. Something that might need a little discovery but makes the ui cleaner."* He chose
    the first of three models offered: a hover hint, with a click that opens a menu. The other two
    were a click that opens the picker directly, and dragging anywhere with a click to change.
    - **No visible cover buttons.** *Change cover*, *Remove* and *Reposition* leave the band.
    - **Hover (editors only):** the cover dims slightly, and a faint *Edit cover ✎* caption shows in
      a corner.
    - **Click:** opens a small menu with *Change cover* · *Reposition* · *Remove*. *Reposition*
      enters the reposition mode above, which is otherwise unchanged.
    - **No cover:** hovering the top of the header shows a faint *+ Add cover* line. Clicking it
      opens the picker.
    - **Keyboard:** the cover is focusable, and `Enter` opens the same menu.
    - **Touch:** where there is no hover, a tap on the cover opens the menu.
    - **Viewers:** no hint, and clicking does nothing.
    - **Where it applies:** the same pattern goes on every surface that shows cover
      add/change/remove buttons, including the phone `CoverSection` and the playbook-day cover. It
      ships in part 4, and the e2e spec opens the menu before choosing *Reposition*.

## Scope

- The URL cover: the contract union, the migration, the set-time check, how browsers load it,
  rendering and the broken-link fallback.
- `/v1/trips/{tripId}/cover` on the public API, its OpenAPI entry and the exposure-list change.
- `position` on the cover, in the API and as the band's drag control.

## Out of scope

- Uploading an image file, or copying a URL's image into Caesura's storage.
- A URL field in the app's cover picker. The app keeps picking from Unsplash; a URL cover comes
  from the API.
- Unsplash search on the public API, and playbook-day covers on the API.

## Exit gate

- [x] **Decisions 4–10 are answered and recorded here**, with the contracts changelog entry and the
      API version. *(Answered and recorded 2026-10-25 with ADR-081. The union is public API 1.28.0,
      `docs/contracts/CHANGELOG.md:35` (part 1, PR 580); the endpoint and `cover-url-rejected` are
      1.29.0, `CHANGELOG.md:16` (part 3, PR 588); `API_VERSION = "1.29.0"` at
      `apps/web/src/server/public-api/openapi.ts:42`.)*
- [x] **A cover set through `PUT /v1/trips/{tripId}/cover` from an image URL shows on the trip page,
      the Home card and the Home hero**, and `GET` returns it. An integration test drives the route with a token.
      *(`apps/web/src/server/public-api/cover.int.test.ts:106` PUTs with a token and GETs it back
      with a same-origin `proxySrc`; `apps/web/src/server/tripCovers.int.test.ts:108` reads that path
      from the getter and from the Home listing; `CoverImage.test.tsx:67` renders a URL cover from
      it, and the band, the Home card and the hero all draw through `CoverImage`
      (`TripCoverBanner.tsx:137`, `TripCard.tsx:303`, `NextTripHero.tsx:327`). CI run 40217156846
      on 23f3d62, the head merged to main as cc93447: integration, unit and `ci-ok` green. Seeing it
      by `curl` on a deployment is the [walk]'s.)*
- [x] **A URL that is not an image, or that points at a private address, is refused and nothing is
      saved.** Each case has a test that was seen red. *(`cover.int.test.ts:128` at the API and
      `tripCovers.int.test.ts:58` at the server, each asserting no row; seen red with the insert moved
      before the fetch, PR 584's and PR 588's red-first tables. Guard ranges, one case each, in
      `remoteImage/guard.test.ts`, PR 584's table. CI run 40217156846.)*
- [x] **No third-party host is sent a viewer's request for a URL cover** (or, if decision 4 goes the
      other way, the CSP change is tested the way `next.config.test.ts` tests Unsplash today).
      *(Decision 4 went the proxy way and the CSP's `img-src` is unchanged. A URL cover's `src` is
      our `/api/cover-image?…` (`cover.int.test.ts:124-125`, origin asserted); the route refuses an
      unsigned URL with 403 before any fetch and serves the image itself
      (`apps/web/src/app/api/cover-image/route.test.ts:30`, `:68`), sandboxed by
      `next.config.ts:236`, tested at `next.config.test.ts:227`. Seen red, PR 584's table. CI run
      40217156846.)*
- [x] **An existing Unsplash cover reads unchanged after the migration**, and its credit still
      renders. *(`apps/web/src/app/api/trips/[tripId]/cover/route.int.test.ts:239`, seen red before
      the `coverOf` mapper change, PR 580's table; `CoverCredit.test.tsx:10` keeps the Unsplash
      wording. Migration 0068 applied in production by `migrate-production` run 40169051627. CI run
      40164717578 on PR 580's head 5715d2e.)*
- [x] **Reposition persists**: a dragged position survives a reload and shows on every surface the
      cover appears on, and `PATCH` with `{ position }` moves it. Its unit test was seen red with
      the `object-position` removed. *(`e2e/m49-cover-reposition.spec.ts:90` drags, reloads and
      reads the framing on Home's hero; `PATCH` at `cover.int.test.ts:146` (API) and
      `[tripId]/cover/route.int.test.ts:273` (app); `CoverImage.test.tsx:48` seen red with
      `objectPosition` removed (`expected '' to be 'center 30%'`), PR 580's table.)*
- [x] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: reposition a cover by mouse
      and by keyboard, reload, and see it held. *(`m49-cover-reposition.spec.ts:90` (mouse) and
      `:136` (keyboard, Enter and Esc), "3 passed" on ci-like in PR 585's body; in CI, `test / e2e`
      (1/2) and (2/2) green in run 40213790458 on PR 585's 76f5332 and run 40217156846 on 23f3d62,
      which main carries as cc93447.)*
- [x] **[walk]** On the PR preview, a cover set by `curl` with an API token appears on the trip, and
      an Unsplash cover is repositioned from the band. *(Ticked on Mitchell's word, 2026-10-25
      17:59Z, in session `session_01KUvY39meF1HrYJTTwCzKeJ`: "Confirmed, and walked. Closed out the
      gate".)*
- [x] A retro is appended at gate close. *(Below.)*

## Retro — written 2026-10-25 (9 of 9 boxes ticked)

Written at the close on part 0 (PR 581). The last box, the [walk], is ticked on Mitchell's word,
2026-10-25 17:59Z: "Confirmed, and walked. Closed out the gate". His walk covered a cover set by
`curl` with an API token showing on the trip, the Home card and the Home hero; an Unsplash cover
repositioned through the hover menu; and the proxy's canonical `/api/cover-image?…` URL answering
200, with the same URL plus `&x=1` answering 403. `pnpm milestone close M49 --confirm` closed the
gate, 9 of 9.

### What went well

- **Four parts merged in one day.** Part 1 (PR 580) merged at 06:24 UTC as `fc07b46`, CI run
  40164717578 green on its head `5715d2e`, and migration 0068 reached production a minute later
  (`migrate-production` run 40169051627). Parts 2, 4 and 3 (PRs 584, 585, 588) merged together at
  17:51–17:52 UTC as `cc93447`.
- **The stack carried one preview.** Parts 2–4 were stacked 588 → 585 → 584 → `main`, so the
  top part's preview (PR 588) showed the proxy, the API and the hidden cover controls together, and
  Mitchell walked one deployment rather than three. Every head was green before the merge: PR 584
  run 40173145537 on `983b23e`, PR 585 run 40213790458 on `76f5332`, PR 588 run 40217156846 on
  `23f3d62` (both e2e shards, integration, unit and `ci-ok`).
- **The SSRF guard was tested range by range.** PR 584's red-first table removes each private,
  loopback, link-local, CGNAT, multicast and IPv6 range in turn and records the failure, and DNS
  rebinding is closed at socket lookup (`guardedLookup`), not just noted. It had four review rounds
  and the extra fresh security pass.
- **Mitchell's mid-build amendment cost one part, not a replan.** He amended decision 10 on
  2026-10-25: no visible cover buttons, a hover hint and a click menu. Part 4 (PR 585) absorbed it,
  including the phone `CoverSection` and the playbook-day band, with its own red-first table.

### What could be better

- **Agents could not walk the API round trip on the preview.** A token needs premium@v2, which a
  preview account does not have (KI-20260916-d), so the verifier walked the UI only and the `curl`
  half of the walk stayed Mitchell's. A preview-only way to mint an entitled token would have let
  an agent close that half.
- **A unit flake failed `ci-ok` once.** PR 585's head `02c81f3` went red on an unhandled
  `window is not defined` after all 477 unit files had passed (run 40172261036); a re-run passed.
  It did not reproduce locally and is filed as KI-20261025-w with a tripwire.
- **CodeQL's `js/request-forgery` fired on the proxy**, which fetches a URL by design behind the
  guard and a signature. Mitchell dismissed it as won't-fix in the UI. Nothing records the
  dismissal in the repo except PR 581's tracker.
- **The orchestrator's share missed its target in both build sessions** (25.7% and 30.6%, against
  under 15%). The amendment and the restack added orchestrator turns that no part owned.

### Leftovers

- **Reposition a playbook day's cover**: `docs/candidates.md`, asked by Mitchell on M49's preview.
- **The unit flake**: KI-20261025-w.
- **The API walk on a preview**: KI-20260916-d.
- The plan (`docs/plans/2026-10-25-M49-covers-from-anywhere.md`) is deleted in this commit. Its
  design lives in ADR-081 and its decisions in this file; nothing else in it needed promoting.

## Spend
<!-- session-metrics:milestone v1 -->

Three sessions, summed from each session's own block (sessions 1 and 2 as carried in their
handoffs; session 3 generated in the close). **42 agents, 1,405 API calls, 17.64M units,
$73.81 recorded** (`list_sessions` → `external_metadata.usage.cost_usd`: $39.45, $32.35 and, at
the time of the close's run, $2.01). Units = input + 1.25 × cache write + 0.1 × cache read.

| Session | Agents | Calls | Units | Recorded $ |
|---|---|---|---|---|
| 1 (`session_01KUvY39…`, scoping and part 1) | 18 | 708 | 8.99M | $39.45 |
| 2 (`session_01SFmwXi…`, parts 2–4) | 22 | 663 | 8.09M | $32.35 |
| 3 (`session_01WX3JjM…`, the close) | 2 | 34 | 555k | $2.01 (at its run) |
| **Total** | **42** | **1,405** | **17.64M** | **$73.81** |

**By agent type, summed**

| Who | Units | Share |
|---|---|---|
| `phase-implementer` (20 agents) | 8.74M | 49.5% |
| `orchestrator` (3) | 5.01M | 28.4% |
| `part-reviewer` (16) | 2.87M | 16.3% |
| `Explore` (1) | 396k | 2.2% |
| `general-purpose` (1, the close) | 337k | 1.9% |
| `phase-verifier` (1) | 299k | 1.7% |

Session 1: phase-implementer 10 agents / 5.25M (58.4%), orchestrator 2.31M (25.7%), part-reviewer
6 / 1.04M (11.6%), Explore 1 / 396k. Session 2: phase-implementer 10 / 326 calls / 3.49M (43.1%),
orchestrator 1 / 107 calls / 2.48M (30.6%, peak 263k), part-reviewer 10 / 190 calls / 1.83M
(22.6%), phase-verifier 1 / 40 calls / 299k (3.7%); costliest: PR 585's hidden cover controls
1.01M, Build part 3 834k, Review PR 588 r1 407k.

Session 3, generated by `pnpm -s session-metrics --milestone <this session's transcript> --parts 4
--lines-added 8089 --cost-usd 2.01`, pasted unchanged below. It ran mid-close, so it misses the
close's last calls:

2 agents, 34 API calls, 555k units, $2.01 recorded. One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | ≈ $ | Share |
|---|---|---|---|---|---|---|---|
| `general-purpose` | 1 | 20 | 100k | 118k | 337k | $1.22 | 60.7% |
| `orchestrator` | 1 | 14 | 108k | 117k | 218k | $0.79 | 39.3% |

**Costliest agents**

| Agent (description) | Type | Calls | Avg context | Peak context | Units | ≈ $ |
|---|---|---|---|---|---|---|
| Close M49 gate on PR 581 | `general-purpose` | 20 | 100k | 118k | 337k | $1.22 |

**Orchestrator turns, by what started them**

| What started the turn | Turns | Units | ≈ $ | Share of orchestrator | Idle |
|---|---|---|---|---|---|
| GitHub / trigger notification | 0 | 0 | $0.00 | 0.0% | 0 of 0 (0 units) |
| Subagent report | 0 | 0 | $0.00 | 0.0% | – |
| Subagent finished | 1 | 46k | $0.17 | 21.3% | – |
| Harness | 0 | 0 | $0.00 | 0.0% | – |
| Human | 3 | 172k | $0.62 | 78.7% | – |
| Other (unrecognised frame) | 0 | 0 | $0.00 | 0.0% | – |

**Follow-ups and cache re-writes**

| Measure | Count | Tokens |
|---|---|---|
| `SendMessage` calls by the orchestrator | 0 | – |
| Coordinator messages received mid-life, by 0 subagent(s) | 0 | – |
| Full cache re-writes in subagents | 0 | 0 |
| — directly after a coordinator message | 0 | 0 |

**Guard hooks**

| Hook | deny | note |
|---|---|---|
| `implementer-brief-check` | 1 | 0 |

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 39.3% |
| No phase-implementer averaging > 250k context | not measurable | no phase-implementer transcripts |
| GitHub wakes per merged part < 5 | met | 0 / 4 = 0.0 |
| Dollars per 1k lines added < 20 | met | $0.25 |
| Coordinator-message re-writes <= 2 | met | 0 |

### Spend against the last milestone

M52 is the last closed milestone. Lines added for M49, by the guideline's rule (PR 580's merge
`fc07b46` and the stack's merge `cc93447`, first parent, without `docs/`, `*.generated.json` and
`pnpm-lock.yaml`): 8,089, of which 3,770 are migration 0068's Drizzle snapshot; 4,319 without it.

- **Dollars per 1,000 lines added (under 20):** met, $9.1 ($73.81 / 8.1k), and $17.1 without the
  snapshot; M52 $11.5 ($27.0 without its snapshots).
- **Orchestrator's share (under 15%):** missed, 28.4% across the three sessions (5.01M of 17.64M);
  M52 estimated about 19%, its close 29.3%. The cause is in *What could be better*.
- **A builder's average context (none over 250k):** met in session 2 (worst 119k); session 1's
  block carried no average; M52 not measurable.
- **GitHub wakes per merged part (under 5):** 0 in the close; the build sessions' blocks as carried
  give no figure; M52 0 in its close.
- **Cache re-writes after a coordinator message (2 or fewer):** 0 in the close; not carried for
  sessions 1 and 2.
