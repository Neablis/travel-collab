# Design pass — 2026-08-30 (live preview)

Findings from a design pass run by hand against this PR's Vercel preview,
recorded as they are found. Each item is either fixed on this branch, filed
under `docs/known-issues/open/`, or dropped with a reason.

## How this pass is being run

- Surface: the Vercel preview built from this PR (not local `pnpm dev`).
- Feedback is left through the Vercel toolbar, which anchors each comment to
  the element and route it was written on.
- `apps/web/src/lib/preview-registry.ts` is the authoritative list of
  deliberately unbuilt surfaces — a `Preview · Mn` chip is a designed shell
  working as intended, not a finding.

## Findings

| # | Route / surface | Viewport | What's wrong | Severity |
| - | --------------- | -------- | ------------ | -------- |
| 1 | `/signin` — dev-login form | 1440×900 | Pressing Enter in the username field appeared to do nothing. | Fixed |

### 1 — Enter in the dev-login field looked inert (and silently ate the input)

Reported through the Vercel toolbar, anchored to `#dev-login-username`.

Enter did work — but only after React had hydrated. Before that, the form is
server-rendered HTML with no `action`, so Enter triggered the browser's
**native implicit submission**: a GET back to `/signin`, which reloaded the
page, emptied the controlled username input, and wrote what had been typed
into the address bar as `?username=…` — and so into browser history, the
referrer, and server access logs.

On screen that is indistinguishable from "Enter does nothing", which is how
it was reported. The window is widest on a cold preview, which is exactly
where the pass was being run.

Reproduced against a production build (`next build` + `next start`), with JS
disabled standing in for "JS has not run yet":

| | before fix | after fix |
| - | ---------- | --------- |
| URL after Enter | `/signin?username=alice` | `/signin` |
| Username field | emptied | keeps `alice` |

**Fix:** gate the dev-login submit button on hydration
(`apps/web/src/components/front/AuthScreen.tsx`). HTML's implicit submission
does nothing when a form's default button is disabled, so Enter is inert
until the handler that gives it meaning exists, rather than firing a
navigation that destroys what the user typed. After hydration, Enter and a
click run the identical path — verified as byte-identical request sequences
(`/api/auth/providers` → `/api/auth/csrf` → `POST /api/auth/callback/dev-login`
→ `/api/auth/session`), both landing on "Your trips".

Deliberately **not** done: making the form work without JS. That means a
server action posting to Auth.js — a change to the auth flow, not a fix to
this defect.

**Guarded by:** two tests in `apps/web/e2e/m15-front-door.spec.ts` — Enter
signs in once hydrated, and (with `javaScriptEnabled: false`) Enter neither
reloads `/signin` nor leaks the username into the URL. Both fail on the
pre-fix build.

## Disposition

| # | Outcome |
| - | ------- |
| 1 | Fixed on this branch, with e2e regression coverage. |
