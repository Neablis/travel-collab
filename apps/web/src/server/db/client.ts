import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DATABASE_URL } from "../config";
import * as schema from "./schema";

const pool = new Pool({ connectionString: DATABASE_URL });
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
