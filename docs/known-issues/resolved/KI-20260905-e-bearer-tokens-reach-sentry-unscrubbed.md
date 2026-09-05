### KI-2026-09-05-e — share and invite bearer tokens reach Sentry unscrubbed on every traced request; no `beforeSend` exists anywhere — **RESOLVED 2026-09-05: in-repo URL scrubbing, proven against the bytes**

- **Severity:** correctness (a security boundary: the whole secret of ADR-026/027 is copied into a third-party SaaS for its retention period)
- **Area:** `apps/web/src/instrumentation.ts:13` (`Sentry.captureRequestError` → the SDK's raw `request_path`); `apps/web/sentry.shared.ts:114-118` (`tracesSampleRate` defaults to 1.0), `:160` (`sendDefaultPii: false`, which strips IPs/cookies/headers but **not** URL paths); `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation-client.ts` — zero occurrences of `beforeSend`, `beforeSendTransaction` or `beforeBreadcrumb` in any of the three inits; `instrumentation-client.ts:10,33-34` (Session Replay records `location.href`)
- **Symptom / What happens:** every `GET /api/shares/<token>`, `/api/invites/<token>/accept` and `/s/<token>` page view is a traced transaction at 100% sampling, and every unhandled error on those routes ships the path. The token is the entire credential. Reproduction: throw inside `s/[token]/page.tsx` and read `contexts.nextjs.request_path` on the event. `SECURITY.md` accepts bearer-in-URL for recipients but says nothing about the operator-side telemetry copy.
- **Why not fixed here:** found by a read-only review. The mechanism was confirmed in the SDK source, **not** observed in a live Sentry event — and whether Sentry project-level scrubbing already masks path tokens is a platform question the repo cannot answer. If it does, this downgrades to belt-and-braces; the in-repo scrub should still land, because the project setting is not visible to a reviewer.
- **Cross-reference:** [F-A07](../../reviews/2026-09-05-overnight-review/findings/F-A07-bearer-tokens-reach-sentry-unscrubbed.md) (severity MEDIUM, CONFIRMED mechanism; merges stream D's D02, and carries the exact `scrubUrl` shape and the list of fields to cover); ADR-026, ADR-027, ADR-032, `SECURITY.md`; `../../reviews/2026-09-05-overnight-review/README.md` §"Leads for a human with platform access".
- **First noted:** 2026-09-05, overnight review streams A + D.
- **Reproduced, not assumed.** A real `@sentry/nextjs` client initialised from
  `sharedSentryOptions` with a capturing transport, driven through
  `Sentry.captureRequestError` (what `instrumentation.ts` exports), a
  `/api/shares/<token>` server span, a navigation breadcrumb and an exception
  whose message quotes `?callbackUrl=`. The token left the process in **nine**
  places across two envelope item types — three more than the entry named,
  which is the argument against a field list:

  ```
  transaction :: .contexts.trace.data.url.full = https://example.test/api/shares/<token>
  transaction :: .contexts.trace.data.url.path = /api/shares/<token>
  transaction :: .spans.0.description          = GET /api/invites/<token>/accept
  transaction :: .transaction                  = GET /api/shares/<token>
  transaction :: .request.url                  = /api/shares/<token>
  transaction :: .breadcrumbs.0.data.to        = /invite/<token>
  event       :: .exception.values.0.value     = fetch failed for /signin?callbackUrl=%2Finvite%2F<token>
  event       :: .breadcrumbs.0.data.to        = /invite/<token>
  event       :: .contexts.nextjs.request_path = /s/<token>
  ```
- **The fix.** `sentry.shared.ts` gains `scrubUrl` (three patterns: `/s|invite/<seg>`,
  `/api/shares|invites/<seg>`, and `?callbackUrl=` — the last because
  `proxy.ts` percent-encodes the path, which the first two cannot see) and
  `scrubSentryPayload`, a guarded deep walk that scrubs **every string** in an
  outbound payload rather than a named field list: `url.full` and `url.path`
  are OpenTelemetry attribute names we do not control, and the next
  integration to attach a URL will pick its own key. It is wired as
  `beforeSend` + `beforeSendTransaction` + `beforeBreadcrumb` inside
  `sharedSentryOptions`, so all three `Sentry.init` calls get it from the one
  place — a scrub that is on for the server and off for the edge reads as done
  and is not.

  Session Replay needed two more hooks, because it reaches neither:
  `prepareReplayEvent` calls `prepareEvent` and sends, never `_processEvent`
  where `beforeSend` lives. `instrumentation-client.ts` adds
  `replayIntegration({ beforeAddRecordingEvent })` for the rrweb payload and
  `Sentry.addEventProcessor` — processors *do* run inside `prepareEvent` — for
  the `replay_event`'s `urls` array.
- **Proof.** The reproduction above is now a permanent test in
  `apps/web/sentry.shared.test.ts` (*"what actually reaches the Sentry
  transport"*), asserting both that no field carries the token and that each
  of the nine still reports its masked value — so it cannot pass by the
  payload being empty. Deleting the three hooks turns it red with the nine
  leak sites listed by name; deleting the `callbackUrl` pattern alone turns it
  red with one. `scrubUrl` has its own shape table, including the paths it must
  **not** touch (`/api/trips/<id>/shares/<shareId>` is an owner-side row id,
  not a bearer token) and an idempotence case. Checks run:
  `pnpm --filter web typecheck`, `pnpm --filter web lint`, and
  `pnpm --filter web exec vitest run -c vitest.unit.config.ts sentry.shared.test.ts lint-scope.test.ts`
  (68 passed).
- **Still open, deliberately, and NOT what this entry was about:** whether
  Sentry's own project-level data scrubbing also masks these paths. The entry
  said the in-repo scrub should land regardless, because a dashboard setting is
  not visible to a reviewer; it has. Two adjacent surfaces are untouched and
  worth a separate entry if they ever carry a URL — `enableLogs` has its own
  `beforeSendLog` hook, and `Sentry.metrics` attributes have none; neither is
  reached by `beforeSend`. Today nothing writes a share URL to either.
- **Resolved:** 2026-09-05.
