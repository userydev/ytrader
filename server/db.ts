import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
export const poolFor = (url: string) => new pg.Pool({ connectionString: url, max: 10 });
export type Pool = pg.Pool;
export type Tx = pg.PoolClient;
export const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function transaction<T>(pool: Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try { await tx.query('BEGIN'); const result = await fn(tx); await tx.query('COMMIT'); return result; }
  catch (error) { await tx.query('ROLLBACK'); throw error; }
  finally { tx.release(); }
}
