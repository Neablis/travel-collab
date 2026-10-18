### KI-2026-10-18-a — a cloud session's local Postgres has no pgvector, so its migrate stops at 0047

- **Severity:** medium for agents. Nothing in production or CI; every cloud session that runs the
  app or an integration test against the local cluster.
- **Area:** `.claude/hooks/session-start.sh` and the native Postgres 16 cluster on 5433
  (`docs/guidelines/cloud-agent-sessions.md`, *Postgres*).
- **Symptom:** on 2026-10-18 the local `travel` database was at 48/58 migrations
  (`pnpm --filter web db:state`). The dev login then failed with `AccessDenied`, whose cause in the
  server log was Postgres `42703` (undefined column) on the `users` insert, because the columns
  0048–0057 add were missing. A `with-test-db` run that migrates a fresh database rolls back the
  same way.
- **Cause:** migration `0054_rag_day_embeddings` runs `CREATE EXTENSION vector`, and the
  container's Postgres 16 has no `postgresql-16-pgvector` package. `drizzle-kit migrate` applies
  every pending migration in one transaction, so 0054's failure rolls back 0048–0057 with it, and
  the session-start hook does not report it. `apt-get install postgresql-16-pgvector`, then
  `pnpm --filter web db:migrate`, brought the database to 59/59.
- **Why not fixed here:** a hook change cannot be tested from inside the session it would run in.
  Found during PR 481, a performance pass.
- **Fix direction:** have `session-start.sh` install `postgresql-16-pgvector` before it migrates
  (or check for `vector` in `pg_available_extensions` and say so loudly), and make the hook fail
  visibly when `db:migrate` exits non-zero. Move this entry to `resolved/` once a fresh session
  starts at the newest migration.
- **First noted:** 2026-10-18, on PR 481.
