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

Full story: **KI-27** in `docs/known-issues.md`, including both recurrences.

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
nothing is installed. A working Chromium is on disk:

    /opt/pw-browsers/chromium-1194/chrome-linux/chrome    # 141.0.7390.37

`playwright-core` asks for a newer build number than the one present and
errors with "run npx playwright install" unless you pass `executablePath`
explicitly. Do that instead of concluding the walk is impossible:

    chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" })

This matters more than it sounds. A CSP, a focus ring and a layout bug are
all enforced or visible only in a renderer — "no browser available" is the
one excuse that turns a verifiable claim into an unverified one, and it was
false both times it was used.

**The Vercel preview is NOT reachable from here.** Deployment Protection
302s every request to `vercel.com/sso-api`, and no bypass token exists in
this environment. That 302 carries Vercel's own headers, not the app's — do
not mistake it for a response from the application. Walk a local production
build instead (`pnpm --filter web build && next start`), which serves
byte-identical headers; build from a clean `git archive HEAD` if other
agents are editing the tree, since `check-lint-wall.mjs` deletes its
fixture mid-run and will break a concurrent `next build`.

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
`docs/known-issues.md` for the symptom.**

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
