/**
 * Spell out the SSL mode `pg@8` already applies, so it stops warning about it.
 *
 * Neon's connection string says `sslmode=require`. `pg-connection-string@2`
 * treats `prefer`, `require` and `verify-ca` as aliases for `verify-full`, and
 * says so with a `SECURITY WARNING` through `process.emitWarning` the first
 * time each process parses one. Node writes that to stderr, and Vercel ranks
 * the whole request by its worst line, so the first request on every cold
 * instance read as an error although it returned 200 (KI-2026-10-03-b).
 *
 * Rewriting those three to `verify-full` changes nothing about the connection
 * (it is the meaning already in force) and keeps the strict meaning when `pg@9`
 * moves the aliases to libpq's weaker one. A string that opted into libpq
 * semantics with `uselibpqcompat=true` is left alone: there those modes mean
 * something else, and the warning is not raised.
 *
 * Not done by filtering `process.emitWarning`, which is the channel real
 * warnings use too.
 */
export function withExplicitSslMode(connectionString: string): string {
  if (/[?&]uselibpqcompat=true(?:&|$)/.test(connectionString)) return connectionString;
  // A textual swap of the one parameter, not a parse-and-reserialise: `URL`
  // would re-encode the credentials in the same string.
  return connectionString.replace(
    /([?&])sslmode=(?:prefer|require|verify-ca)(?=&|#|$)/,
    "$1sslmode=verify-full",
  );
}
