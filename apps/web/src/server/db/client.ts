import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/travel";

const pool = new Pool({ connectionString: DATABASE_URL });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
