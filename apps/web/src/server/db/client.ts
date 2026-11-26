import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DATABASE_URL } from "../config";
import * as schema from "./schema";
import { withExplicitSslMode } from "./sslMode";

// `max: 10` is pg's own default, spelled out because the connection budget in
// docs/ops/coolify-vps.md adds it up. The real changes are the idle timeout (30s,
// pg's default is 10s) and `connectionTimeoutMillis`, which pg's default leaves
// off: it fails a stalled connect in 10s, and also bounds a request's wait in the
// pool's queue, so with all 10 clients busy for 10s a request throws `timeout
// exceeded when trying to connect` rather than waiting on.
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
