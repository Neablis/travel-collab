### KI-2026-09-23-a — the e2e lane's `MaxListenersExceededWarning` is Next.js's own proxy, not this repo's code

- **Severity:** noise, not behaviour. Nothing leaks, nothing fails, no test is
  affected. What is wrong is that a full e2e run prints it **834 times** and it
  reads like a memory leak in the application.
- **Area:** `next@16.3.3`'s vendored `compression` and `httpxy`, reached under
  `next start` (`apps/web` has no compression or proxy configuration of its
  own — `next.config.ts` mentions neither).

- **Symptom:** interleaved through `[WebServer]` output on every e2e spec:

  ```
  (node:6244) MaxListenersExceededWarning: Possible EventEmitter memory leak
  detected. 11 close listeners added to [ServerResponse]. MaxListeners is 10.
  ```

  834 occurrences in one full run (2026-09-23), spread across **34 of the 35
  specs** roughly in proportion to how many requests each makes — 149 on
  `m14-notebook-widgets`, 123 on `m20-entitlements`, down to 3 on
  `m4-money-and-lenses`. That spread is the first evidence it is not about any
  one feature.

- **ROOT CAUSE, with the stack rather than a theory.** Re-run with
  `NODE_OPTIONS=--trace-warnings` (`m6-optimistic`, 15 occurrences):

  ```
  at ServerResponse.addListener (node:events:611:10)
  at ServerResponse.on   (next/dist/compiled/compression/index.js:22:894)
  at ServerResponse.once (node:events:655:8)
  at Readable.pipe       (node:internal/streams/readable:1041:8)
  at handleResponse      (next/dist/compiled/httpxy/index.js:1:9943)
  at ClientRequest.<anonymous> (next/dist/compiled/httpxy/index.js:1:9981)
  ```

  **There is no application frame anywhere in it.** Next's own proxy
  (`httpxy`) pipes an upstream response into the client-facing
  `ServerResponse`, and its vendored `compression` middleware registers a
  `close` listener on each pipe. Not our routes, not Sentry, not the AI
  streaming path — the first theory, and wrong, because the warning appears on
  specs that never call the assistant.

- **Why it is a false positive.** `MaxListeners` is a leak *heuristic*: ten is
  an arbitrary threshold for "you probably forgot to remove these". These are
  bounded per response and released with it. Nothing accumulates across
  requests, which is what an actual leak would do and what 834 warnings across
  a six-minute run would have shown as growing memory. It did not.

- **NOT REPRODUCED outside the e2e lane, and the failed attempts are recorded
  so nobody repeats them.** Against the same `next start` binary on the same
  build:

  | Attempt | Result |
  | --- | --- |
  | 30 sequential `curl` to `/` and `/api/account/preferences` | 0 warnings |
  | 60 parallel `curl` to `/` | 0 warnings |
  | 40 parallel `curl` with `Accept-Encoding: gzip, deflate, br` | 0 warnings |
  | One e2e spec through Playwright | 15 warnings |

  So a gzip-accepting client is **not** sufficient, which was the obvious
  hypothesis and is disproved above. What the e2e lane has and `curl` does not
  is a signed-in browser session fetching a real page's full subresource set
  over keep-alive. Exactly which of those provokes Next's proxy path is **not
  established**, and this entry does not guess.

- **What was deliberately NOT done.** Raising `events.defaultMaxListeners`
  would silence it in one line and is rejected: it is process-global, so it
  would also raise the threshold for every emitter in our own code, and the
  next genuine listener leak this repo writes would be the one nobody is
  warned about. Trading a real future signal for a cosmetic present one is the
  wrong side of that bargain — the same reasoning `apps/web/scripts/container-chromium.mjs`
  uses for refusing `--ignore-certificate-errors`.

- **What would settle it:** whether a later Next release changes this
  (16.3.3 is what is pinned), or whether the proxy path can be avoided at all
  under `next start`. Neither is worth a dependency bump on its own; fold it
  into the next Next upgrade and check whether the line disappears.
- **Found by:** Mitchell, reading `pnpm --filter web test:e2e` output,
  2026-09-23.
- **First noted:** 2026-09-23.
