import "dotenv/config";
import pg from "pg";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});
export type DB = pg.PoolClient;
export async function tx<T>(
  org: string | undefined,
  fn: (db: DB) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (org) await db.query("select set_config('app.org_id',$1,true)", [org]);
    const out = await fn(db);
    await db.query("COMMIT");
    return out;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function one<T = any>(
  db: DB,
  sql: string,
  args: unknown[] = [],
): Promise<T> {
  const r = await db.query(sql, args);
  return r.rows[0];
}
export async function rows<T = any>(
  db: DB,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return (await db.query(sql, args)).rows;
}
