#!/usr/bin/env node
// Signups per channel, for the terminal (M50 decision 14, ADR-079):
//
//   pnpm signups-by-ref                                  # the database in apps/web/.env.local
//   DATABASE_URL=<production url> pnpm signups-by-ref    # any other
//
// The same question the operator console's Users tab answers
// (`signupsByRef` in apps/web/src/server/entitlements/admin.ts), asked in SQL
// here because a script cannot import the app's TypeScript. Read-only: one
// SELECT over `users.signup_ref`, a null ref printed as *direct*.
import { createRequire } from "node:module";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("signups-by-ref: DATABASE_URL is not set (apps/web/.env.local, or the environment).");
  process.exit(2);
}

// `pg` is the web app's dependency, not the root's, so it is resolved from there.
const pg = createRequire(new URL("../apps/web/package.json", import.meta.url))("pg");

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
await client.connect();
try {
  const { rows } = await client.query(`
    select coalesce(signup_ref, 'direct') as channel,
           (count(*) filter (where created_at >= now() - interval '7 days'))::int as last_7_days,
           (count(*) filter (where created_at >= now() - interval '30 days'))::int as last_30_days,
           count(*)::int as all_time
      from users
     group by signup_ref
     order by all_time desc, signup_ref asc nulls last`);
  if (rows.length === 0) console.log("No signups yet.");
  else console.table(rows);
} finally {
  await client.end();
}
