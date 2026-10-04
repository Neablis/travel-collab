### KI-2026-10-03-a — an abandoned `<Link>` prefetch logs `⨯ Error: The destination stream closed early.`

- **Severity:** reliability of the signal, not of the app. Nothing a person
  sees changes and no test fails. What was wrong is that every prefetch a
  visitor abandoned became an **unhandled Sentry issue** and a `⨯` error line
  in the runtime log. Both of those read like a server fault, and neither is
  one. The Sentry half is fixed (below). The log line is Next's own, and no
  app-side fix exists for it, so this entry stays open.
- **Area:** `apps/web/src/instrumentation.ts` (`onRequestError`, where the
  Sentry half is filtered); `next@16.3.6`'s
  `dist/server/app-render/create-error-handler.js` (`isAbortError`) and
  `dist/server/next-server.js` (`instrumentationOnRequestError`, which prints
  the line); React's `pipe()` cancel handler in the vendored
  `react-server-dom-*-server.node` and `react-dom-server.node`.

- **Symptom:** in e2e `[WebServer]` output (and, in production, the Node
  runtime log):

  ```
  [WebServer] ⨯ Error: The destination stream closed early.
  [WebServer]     at ignore-listed frames {
  [WebServer]   digest: '1155381919'
  [WebServer] }
  ```

  The run still passes. It was 6 lines with 179/179 passing on a full
  `--project=desktop` run (2026-10-03), and 4 lines with 232/232 in an earlier
  session. The digest is the same across one build (`string-hash(message +
  stack)`) and changes from build to build: `1740255862` earlier,
  `1155381919` here. **Do not search for a fixed digest.**

- **ROOT CAUSE, from a request trace rather than a theory.** A temporary
  `onRequestError` that logged the request and the error context was run
  through a full desktop e2e run. Then it ran again on `m12-moderation` plus
  `m26-shared-day-map` with `--repeat-each=5`. **All 23 hits were the same
  kind of request.** Each one was a `<Link>` viewport prefetch: headers
  `rsc: 1` and `next-router-prefetch: 1`, context `routeType: render` and
  `renderSource: react-server-components-payload`. Each was for
  `/playbooks/day/[savedDayId]` or `/playbooks/profile/[userId]`, and each
  came from a page the test was leaving:

  | Referer (the page being left) | Prefetch cut off | Spec |
  | --- | --- | --- |
  | `/playbooks?city=Naraemod…` | the day card, the author's profile link | `e2e/m12-moderation.spec.ts` (`discoverIn` → immediate `goto`) |
  | `/playbooks?scope=yours` | two day cards | `e2e/m12-moderation.spec.ts:160` |
  | `/playbooks` | a day card, the profile link | another `/playbooks` visitor in the same run |
  | `/playbooks/day/nothing-located-…` | the author's profile link | `e2e/m26-shared-day-map.spec.ts:150` (last step, then the context closes) |

  So the earlier hypothesis was right about the mechanism and wrong about the
  page. **Mostly the cause is the Discover cards on the library page**, and
  only once the shared-day page. It also depends on load. The same specs in a
  7-spec run printed nothing. Under the full suite, or `--repeat-each=5`, they
  printed it every time.

  The chain, read in `next@16.3.6`: on the Node runtime
  `__NEXT_USE_NODE_STREAMS` is true (`build/define-env.js`), so
  `renderToNodeFlightStream` pipes React into a `PassThrough`
  (`app-render/stream-ops.node.js`). When the browser cancels the prefetch,
  the response closes, the `PassThrough` closes, and React's
  `destination.on("close")` aborts the render with a **plain**
  `new Error("The destination stream closed early.")`.
  `createReactServerErrorHandler` drops aborts only when `name` is
  `AbortError` or `ResponseAborted`, so this one passes. It then goes to
  `onInstrumentationRequestError`. That calls our `onRequestError`, which was
  `Sentry.captureRequestError`, reporting it as `handled: false`. Then
  `next-server.js` calls `logError(err)`, which prints the `⨯` line.

- **What was fixed (the Sentry half).** `onRequestError` now drops an error
  whose message is exactly `The destination stream closed early.` and passes
  everything else to `Sentry.captureRequestError` unchanged. That includes
  React's other cancel, `The destination stream errored while writing data.`,
  because a write failure is not known to be a client leaving.
  `apps/web/src/instrumentation.test.ts` gets the error from React's real
  `renderToPipeableStream` instead of typing it out. A React upgrade that
  rewords the message therefore fails that test and does not quietly bring
  the issue back. Red-first: deleting the filter fails with *expected
  "vi.fn()" to not be called at all, but actually been called 1 times*.
  Widening it to `startsWith("The destination stream")` fails the
  errored-write case.

- **Why the log line is not fixed here.** Next prints it in
  `next-server.js` *after* `onRequestError` returns, unless `silenceLog` is
  set. Next sets `silenceLog` only for an error that crossed a `'use cache'`
  boundary. Nothing an instrumentation hook returns changes that. The options
  that do exist were rejected:
  - `prefetch={false}` on the library's links would remove the line by making
    every card click slower for real visitors. That trades user-visible
    behaviour for log hygiene.
  - Wrapping `console.error` or Next's logger to drop the line would be a
    process-wide filter on the one channel a real server error is printed to.
    That is the same reason `KI-2026-09-23-a` refused to raise
    `defaultMaxListeners`.
  - `pnpm patch` on `next` to treat React's close as an abort would be a fork
    of framework behaviour that every Next upgrade has to carry.

  The correct fix is upstream: Next's `isAbortError` (or React) should classify
  the destination closing as an abort.
- **What would settle it:** a Next release whose abort check covers this
  error. Check at the next Next upgrade: run the full desktop e2e lane and
  `grep -c "destination stream closed early"` the output. Zero means move this
  entry to `resolved/`.
- **Cross-reference:** `KI-2026-09-23-a` (the other Next-internal line in the
  same output, with the same "fold into the next Next upgrade" closing
  condition).
- **First noted:** before the SEO pass (8 of 8 runs on older code). Filed and
  root-caused 2026-10-03.
