# Working in a Claude Code cloud session

Answers: **what is different about this container, and which of my failures are
its fault rather than the code's?**

Most agent work on this repo now happens in a Claude Code *remote* session — an
ephemeral container, repo cloned fresh at start, reclaimed after inactivity.
The environment is capable (4 CPUs, 16GB RAM in the sessions measured); it is
not a constrained machine and should not be reached for as an explanation.

This guide exists because it was reached for anyway. See **The rule that
matters** at the bottom.

---

## E2E: two lanes, only one of which counts

The single most expensive trap in this container, hit twice.

`playwright.config.ts` serves **`pnpm dev` locally** and **`pnpm start`
(production build) under CI**. Dev mode compiles each route on its first hit —
3.8s cold against 0.2s warm — so a cold compile can spend a test's whole budget
before the test does anything interesting.

| | Lane | Use it for |
|---|---|---|
| `pnpm --filter web test:e2e` | dev server | iterating on a spec you are writing |
| `pnpm --filter web test:e2e:ci-like` | production build, `CI=true` | **any result you will act on, report, or tick a PR box for** |

Three things now make this harder to get wrong:

1. **The failing output says so.** `e2e/laneReporter.ts` appends the warning to
   any failing local run, because prose in a guide only helps someone who
   already opened the guide.
2. **The local budgets fit the local server** — `timeout` 120s and `expect`
   20s when `CI` is unset, against CI's 30s/5s. This narrows the noise band; it
   does **not** move the trust boundary. At full-suite parallelism the dev lane
   still fails specs that `ci-like` passes (measured: 21/23 vs 23/23).
3. `AGENTS.md`'s Testing model states the rule as law.

**Signature to recognise:** a failure whose **location moves between runs** is a
timeout. A real defect fails in the same place every time. Chasing a wandering
failure as if it were a defect is what cost the day.

Full story: **KI-27** in `docs/known-issues/`, including both recurrences.

## Postgres

A native cluster on **5433**, started and migrated by
`.claude/hooks/session-start.sh` — there is no docker daemon here and none is
needed. `docker ps` showing nothing is normal; `pg_isready -h 127.0.0.1 -p
5433` is the check that means anything. See `environments-and-deploys.md`.

## Browsers

Playwright's browsers live at `PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers`),
pre-installed — **never run `playwright install`**. The revision the pinned
`@playwright/test` asks for and the revision with a usable headless-shell
binary have already diverged once, which broke every e2e run until they were
linked. `link_playwright_shell` in the session hook now repairs that on every
start, generically. If e2e dies on a missing executable, read that function
first.

**There IS a browser here. Do not report otherwise.** Two agents on
2026-08-28 independently concluded "this container has no browser" and
skipped a browser verification on that basis — one of them recorded it in
a known-issues entry as fact. Both checks were wrong in the same way: they
looked for `chromium`/`chrome` on `PATH` and at `~/.cache/ms-playwright`
(empty), and took `playwright install` failing as confirmation. It fails
because the proxy 403s `cdn.playwright.dev` (see below), not because
nothing is installed. A working Chromium is on disk, under
`$PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers`).

**Do not hardcode a path to it, and do not copy one out of this file.** This
paragraph used to name `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
and say `playwright-core` wants a newer revision than the one present, so an
explicit `executablePath` was required. Both halves have since gone stale, and
a script written from them was wrong in two ways at once: the image now also
carries `chromium-1228` — the revision `playwright-core` actually asks for —
and it uses a **different layout**, `chrome-linux64/chrome` rather than
`chrome-linux/chrome`, so bumping the number alone would still have missed it.
The pin quietly selected the older build.

    ls "$PLAYWRIGHT_BROWSERS_PATH"       # what is actually here, today

`chromium.launch()` with no `executablePath` resolves and launches correctly
now. Let it. If you need a fallback for an image where it does not, scan for
the highest `chromium-<revision>` and accept either layout — see
`resolveFallbackChromium()` in `apps/web/scripts/walk-preview.mjs`.

This matters more than it sounds. A CSP, a focus ring and a layout bug are
all enforced or visible only in a renderer — "no browser available" is the
one excuse that turns a verifiable claim into an unverified one, and it was
false both times it was used.

**The Vercel preview IS reachable from here.** This paragraph used to say the
opposite, and stopped three runs from testing where the bug was. Deployment
Protection does 302 every unauthenticated request to `vercel.com/sso-api`, and
that 302 carries Vercel's headers, not the app's — do not mistake it for a
response from the application. But there are two ways past it, and both work
from this container:

    pnpm --filter web walk:preview <url> [path ...]

`apps/web/scripts/walk-preview.mjs` is the whole recipe, with the diagnosis in
its header. Give it either a `?_vercel_share=` URL (mint one for any deployment
with the Vercel MCP's `get_access_to_vercel_url`; valid 23 hours) or a plain
preview URL with `VERCEL_AUTOMATION_BYPASS_SECRET` set. It reports status,
title and console errors per path, and exits non-zero if a path fails — so it
is usable as a check, not just as a look.

**The `_vercel_share` half of that did not work on 2026-08-30, and the failure
is worth recognising rather than re-deriving.** A freshly minted share link
redeemed as `429 Vercel Security Checkpoint` — twice, five minutes apart, at
the redeem step, before any app response:

    redeem  429  -> https://<preview>/demo
    429  /   Vercel Security Checkpoint

That is Vercel's anti-bot interstitial, not rate limiting and not Deployment
Protection: the link is valid and the checkpoint challenges the *client*, which
is headless Chromium on a datacenter IP. So a share link is enough for a person
in a browser and is NOT reliably enough for the automated walk from here. It
may pass on another day or another egress IP; treat a pass as luck, not as the
supported route.

**`VERCEL_AUTOMATION_BYPASS_SECRET` is therefore the only dependable route for
an unattended walk**, because the bypass header is honoured before the
checkpoint ever renders. Until that secret exists, a cloud session cannot
produce preview evidence for a gate, and should say so rather than reporting a
walk it could not perform.

**The secret now exists** (Vercel → Settings → Deployment Protection →
Protection Bypass for Automation) and was used for a full signed-in walk on
2026-09-03. Two things that were not obvious the first time:

- **It has to be in the SESSION's environment, not just in Vercel.** A cloud
  container's environment is fixed when it starts, so setting the value in the
  project does not reach a session already running — it has to be handed to
  that session. The value is deliberately not written down in this repo.
- **A signed-in walk needs no invite code.** `server/admission.ts` evaluates
  admission only for someone with **no `users` row**; an existing dev user is
  admitted as `returning-user`. So `/signin` → dev login as a username that has
  been here before is enough. `INVITE_SUPER_CODE` is a first-sign-in concern and
  `playwright.config.ts` injects it only into the LOCAL e2e web server — which
  is easy to misread as "the preview is unreachable".

One trap that cost two runs, and belongs to whoever writes the walk script
rather than to the app: Playwright's `getByRole(..., { name })` matches the
accessible name by **substring**. A fixture trip named `[walk] notebooks …`
makes the trip-title button (accessible name `<trip name> — Trip settings`)
match `getByRole("button", { name: "Notebooks" })`, and the resulting strict-mode
violation reads exactly like the app rendering the control twice. Name walk
fixtures so they cannot collide with a control you intend to query.

Three things had to be true at once, and each failed with an error naming none
of the others. Worth knowing, because they bite anything else you point at the
network from a renderer:

1. **Chromium does not read `/etc/ssl/certs`,** so the egress gateway's
   TLS-inspection CA is untrusted and inspected hosts fail
   `ERR_CERT_AUTHORITY_INVALID` — even though `curl` and `node` are fine, which
   is what makes it confusing. `certutil` is not installed, so the script pins
   the container's own CAs by SPKI hash instead. That is five named
   certificates, not `--ignore-certificate-errors`.
2. **`*.vercel.app` is tunnelled, not inspected,** and the tunnel cannot carry
   Chromium's TLS 1.3 ClientHello (~1830 B with the post-quantum key share).
   The upstream answers 39 B and resets: `ERR_CONNECTION_RESET`, with nothing
   pointing at TLS. `--ssl-version-max=tls1.2` shrinks the ClientHello and it
   goes through. Every `--disable-features=` spelling of the post-quantum flag
   was tried first and none worked on Chromium 141. The cost: a walk from here
   exercises TLS 1.2, so it is not evidence about anything TLS-version-specific.
3. **Deployment Protection**, above.

A local production build (`pnpm --filter web build && next start`) is still the
right thing for anything that does not depend on the deployed environment, and
it is faster. What it cannot show you is what Vercel's own edge adds — the
first real preview walk, 2026-08-29, found the Vercel Toolbar's loader blocked
by our CSP, which twenty local surfaces had not. Build from a clean
`git archive HEAD` if other agents are editing the tree, since
`check-lint-wall.mjs` deletes its fixture mid-run and will break a concurrent
`next build`.

## Egress goes through a proxy, and some hosts are blocked

Outbound HTTPS uses the agent proxy (CA bundle at `/root/.ccr/ca-bundle.crt`).
**Never disable TLS verification or unset `HTTPS_PROXY`** to get around a
failure; `curl -sS "$HTTPS_PROXY/__agentproxy/status"` explains what is actually
happening.

What this costs us, concretely: **`tiles.openfreemap.org` is blocked, so the Map
lens cannot be visually verified in this container** — the rail, focus card and
legend render against a blank canvas. Map work has to be checked on the Vercel
preview, and a local "looks fine" is not evidence about the map. Say so
explicitly rather than letting a blank canvas read as a pass.

## Secrets

**Never put real secrets in the cloud session's environment-variables field** —
`LOCATIONIQ_API_KEY` and `AI_GATEWAY_API_KEY` belong in Vercel's env scopes.
Only non-secret gates (`SEED_DEMO_DATA=true`) are appropriate there.

## The container is ephemeral

Anything worth keeping is committed and pushed. A hand-fix applied to the image
(a symlink, an installed package, a started service) is gone next session — if
it is needed again, it belongs in `.claude/hooks/session-start.sh`, not in a
future agent's memory.

Writable disk is a fixed allowance, so `df` misleads: "Avail" at 0 with low
"Used" means the allowance is spent. Deletes still succeed while writes fail.

## The rule that matters

**Before attributing a failure to the environment, grep
`docs/known-issues/` for the symptom.**

Every claim in this guide was already written down somewhere before it was
learned the hard way a second time. KI-27 described the e2e lane trap in full,
and `quality-enforcement.md` already said to run `test:e2e:ci-like` "always
before opening/updating a PR whose diff touches a user-facing flow". Neither was
read; a day went into re-deriving KI-27 from scratch, and the conclusion
reported to Mitchell — that a cloud container was limited by local hardware —
was wrong on its face.

"Environmental", "flaky" and "infra" are conclusions requiring evidence, not
defaults to fall back on when a test is stubborn. They are the most expensive
things to be wrong about, because each one ends the investigation. If you are
about to write one in a PR or say it to Mitchell, you need a specific mechanism
and a check that distinguishes it from the code being broken.
