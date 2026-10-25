### KI-2026-10-19-j — A shared day can say "not shared" after a 500, when "Try again" is pressed twice and the replies cross — RESOLVED

- **Severity:** cosmetic. The wrong one of two error lines; no data is wrong.
- **Area:** `apps/web/src/components/playbooks/SharedDayScreen.tsx:233-238` (`notShared`, set by
  every `read()` from its own result) and the error copy at about line 488.
- **Symptom / What happens:** press "Try again" twice. If the older request's 404 arrives after
  the newer request's 500, `notShared` ends `true` and the screen says *This day is not shared*
  instead of *This day did not load*.
- **Why not fixed here:** accepted as a nit by PR 501's re-review of `c6d4f41`: it needs two
  retries and out-of-order replies on the same day, and a per-request token was not worth the
  code. The close is prose-only.
- **Fix direction:** keep a request counter in a ref and set `notShared` only from the latest
  request's result.
- **Cross-reference:** M50 part 6 (PR 501).
- **First noted:** 2026-10-19, PR 501's re-review.
- **Proof (resolved 2026-10-24, KI sweep):** the fix direction, as written: `read()` takes a
  number from a `latestRead` ref and sets `notShared` only if it is still the latest, the same
  latest-wins rule `useLibraryRead`'s generation applies to `feed`. On the live UI a double
  retry is hard to reach (the empty state's Try again unmounts while a read is in flight), but
  React's StrictMode double effect puts two first reads in flight. The new
  `SharedDayScreen.test.tsx` case *words the failure from the latest read when an older one
  answers last* uses that: the newer read 500s, then the older 404s. On the old code it failed
  with `Unable to find role="heading" and name "This day did not load"`, the page reading *This
  day is not shared*. With the fix the file passes, 100/100.
