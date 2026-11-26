import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DATABASE_URL } from "../config";
import * as schema from "./schema";
import { withExplicitSslMode } from "./sslMode";

// Limits set out loud rather than left to pg's defaults (no timeouts): one
// server holds this pool, so 10 connections is its whole share of a small
// Postgres, an idle one is let go after 30s, and a connect that stalls fails in
// 10s instead of hanging a request.
const pool = new Pool({
  connectionString: withExplicitSslMode(DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
export const db = drizzle(pool, { schema });
export type Db = typeof db;

/**
 * The pool, or a transaction on it — whichever a caller was handed.
 *
 * `access/members.ts` has had this type inline since M11 because half its
 * functions run inside a command transaction and half do not. It is exported
 * here now that a second module needs it: the referral loop counts a rolling
 * window and then writes, and that pair has to happen under one lock.
 */
export type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
