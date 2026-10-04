### KI-2026-10-03-b — `pg`'s sslmode deprecation warning makes a successful request show up at error level in the runtime log

- **Severity:** reliability of the signal, not of the app. Nothing a person
  sees changes, and every affected request returns 200. What is wrong is that
  a search for error-level lines, the habit `ai-usage` and the runtime-errors
  triage both rely on, turns up healthy requests. Real failures are mixed in
  with them.
- **Area:** `apps/web/src/server/db/client.ts` (`new Pool({ connectionString:
  DATABASE_URL })`); the `DATABASE_URL` value in Vercel's Production and
  Preview environments (`sslmode=require`, Neon's default connection string);
  `pg-connection-string@2.14.0`'s `index.js`, which calls
  `process.emitWarning` once per process.

- **Symptom:** in the production runtime log, a `POST /api/trips/…/ask` that
  returned **200** is listed as `[error/serverless]` and starts with:

  ```
  (node:4) Warning: SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'.
  In the next major version (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt standard libpq semantics, which have weaker security guarantees.
  ```

  Then come its normal `ai.grant` and `ai.ask` lines with `outcome:
  "completed"`. Seen 2026-10-03 on two of the first three live `/ask` turns.
  The third reached a warm instance, so it logged at `info`. The warning is
  emitted **once per process** (`deprecatedSslModeWarning.warned`), so it
  marks the first request each cold instance serves. The route itself does
  not matter. Node writes warnings to stderr, and Vercel ranks a request by
  its worst line.

- **Cause:** `sslmode=require` in the connection string. `pg@8` already
  treats it as `verify-full`, and it warns that `pg@9` will change the
  meaning to libpq's (encrypt, but do not verify the server).

- **Why not fixed here:** this entry was filed to record the noise. The fix
  touches either a secret or connection setup, and both deserve their own
  change. The fix is one of:
  1. **Set `sslmode=verify-full` in `DATABASE_URL`** in each Vercel
     environment. This is the behaviour already in force, written out, so the
     warning stops and nothing changes. It is Mitchell's step, because it
     edits a secret.
  2. Or normalize it in `client.ts`: rewrite `sslmode=require` to
     `verify-full` before building the pool. That is a code fix every
     environment picks up. Its cost is a rewrite of a secret's value that
     nobody sees.

  Either way, do **not** reach for `uselibpqcompat=true`. That opts into the
  weaker libpq meaning, which is the opposite of what the warning is
  protecting. And do not filter `process.emitWarning`. That filters the same
  channel real warnings use, which `KI-2026-09-23-a` and `KI-2026-10-03-a`
  also refused to do.

- **What would settle it:** after the fix, deploy and send one request to a
  cold instance. The runtime log for that request should show `info`, with no
  `SECURITY WARNING` line. Also confirm `grep -c "SECURITY WARNING"` over a
  day of production logs is 0.
- **Cross-reference:** `KI-2026-10-03-a` (the other line that makes a healthy
  request read like a server fault); `.claude/skills/ai-usage/SKILL.md`
  (*Fetching*, where the error-level habit is described).
- **First noted:** 2026-10-03, reading the first live production `/ask`
  turns after M31's ledger shipped.
