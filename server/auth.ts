import { randomBytes, scrypt as cryptoScrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hash, id, type Pool } from './db.js';
import type { Config } from './config.js';
const scrypt = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => cryptoScrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key)));
export async function hashPassword(password: string) {
  if (password.length < 16 || password.length > 1024) throw new Error('Password must be 16–1024 characters');
  const salt = randomBytes(32).toString('hex');
  return `scrypt-v1$${salt}$${(await scrypt(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [format, salt, hex] = encoded.split('$');
  if (format !== 'scrypt-v1' || !/^[a-f0-9]{64}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(hex ?? '')) return false;
  return timingSafeEqual(await scrypt(password, salt), Buffer.from(hex, 'hex'));
}
export class ApiError extends Error { constructor(public status: number, public code: string, message: string = code) { super(message); } }
export type Session = { token_hash: string; user_id: string; client: 'web' | 'ios'; csrf: string; expires_at: Date };
declare module 'fastify' { interface FastifyRequest { session: Session | null } }
export const cookieName = (config: Config) => config.secureCookie ? '__Host-ytrader' : 'ytrader-dev';
export function installAuth(app: FastifyInstance, pool: Pool, config: Config) {
  app.decorateRequest('session', null);
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin !== config.webOrigin && origin !== config.nativeOrigin) throw new ApiError(403, 'FORBIDDEN', '来源不受信任');
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
      if (origin === config.webOrigin) reply.header('Access-Control-Allow-Credentials', 'true');
    }
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (request.method === 'OPTIONS') {
      if (!origin) throw new ApiError(403, 'FORBIDDEN');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS').header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token').code(204).send();
    }
  });
  app.addHook('preHandler', async request => {
    if (
      request.method === 'OPTIONS' ||
      request.url.split('?')[0] === '/api/v1/auth/login' ||
      request.url.split('?')[0] === '/api/v1/auth/dev-session'
    ) return;
    const auth = request.headers.authorization;
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    const token = bearer ?? request.cookies[cookieName(config)];
    if (!token || token.length > 256) throw new ApiError(401, 'UNAUTHENTICATED');
    const result = await pool.query<Session>(`UPDATE sessions SET touched_at=now() WHERE token_hash=$1 AND expires_at>now() AND touched_at>now()-interval '7 days' RETURNING token_hash,user_id,client,csrf,expires_at`, [hash(token)]);
    const session = result.rows[0];
    if (!session || (bearer ? session.client !== 'ios' : session.client !== 'web')) throw new ApiError(401, 'UNAUTHENTICATED');
    if (!['GET','HEAD'].includes(request.method)) {
      if (session.client === 'web' && (request.headers.origin !== config.webOrigin || request.headers['x-csrf-token'] !== session.csrf)) throw new ApiError(403, 'FORBIDDEN', '请求校验失败');
      if (session.client === 'ios' && request.headers.origin && request.headers.origin !== config.nativeOrigin) throw new ApiError(403, 'FORBIDDEN');
    }
    request.session = session;
  });
  app.post('/api/v1/auth/login', async (request, reply) => {
    const { password, client } = z.object({ password: z.string().min(1).max(1024), client: z.enum(['web','ios']) }).parse(request.body);
    if (request.headers.origin !== (client === 'web' ? config.webOrigin : config.nativeOrigin)) throw new ApiError(403, 'FORBIDDEN');
    const rate = await pool.query(`INSERT INTO login_limits(key,started_at,attempts) VALUES($1,now(),1)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.started_at<now()-interval '15 minutes' THEN 1 ELSE login_limits.attempts+1 END,
      started_at=CASE WHEN login_limits.started_at<now()-interval '15 minutes' THEN now() ELSE login_limits.started_at END RETURNING attempts`, [hash(request.ip)]);
    if (rate.rows[0].attempts > 10) { reply.header('Retry-After','900'); throw new ApiError(429, 'RATE_LIMITED', '尝试过多，请稍后再试'); }
    const user = (await pool.query('SELECT id,password_hash FROM users LIMIT 1')).rows[0];
    // Real scrypt work also when bootstrap has not run; never disclose account existence.
    const valid = await verifyPassword(password, user?.password_hash ?? `scrypt-v1$${'0'.repeat(64)}$${'0'.repeat(128)}`);
    if (!user || !valid) throw new ApiError(401, 'UNAUTHENTICATED', '无法登录，请检查密码');
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    const result = await pool.query('INSERT INTO sessions(token_hash,user_id,client,csrf) VALUES($1,$2,$3,$4) RETURNING expires_at', [hash(token), user.id, client, csrf]);
    if (client === 'web') reply.setCookie(cookieName(config), token, { path: '/', httpOnly: true, secure: config.secureCookie, sameSite: 'lax', maxAge: 30 * 86400 });
    return { expires_at: result.rows[0].expires_at, ...(client === 'web' ? { csrf_token: csrf } : { session_token: token }) };
  });
  app.get('/api/v1/auth/session', async request => ({ authenticated: true, expires_at: request.session!.expires_at, ...(request.session!.client === 'web' ? { csrf_token: request.session!.csrf } : {}) }));
  app.get('/api/v1/auth/dev-session', async (_request, reply) => {
    let user = (await pool.query('SELECT id FROM users LIMIT 1')).rows[0];
    if (!user) {
      const encoded = await hashPassword('ytrader-dev-analyst-password-2026');
      const newUser = (await pool.query('INSERT INTO users(id,password_hash) VALUES($1,$2) RETURNING id', [id('usr'), encoded])).rows[0];
      user = newUser;
    }
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    const result = await pool.query('INSERT INTO sessions(token_hash,user_id,client,csrf) VALUES($1,$2,$3,$4) RETURNING expires_at', [hash(token), user.id, 'web', csrf]);
    reply.setCookie(cookieName(config), token, { path: '/', httpOnly: true, secure: config.secureCookie, sameSite: 'lax', maxAge: 30 * 86400 });
    return { authenticated: true, csrf_token: csrf, expires_at: result.rows[0].expires_at };
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [request.session!.token_hash]);
    reply.clearCookie(cookieName(config), { path: '/', secure: config.secureCookie, httpOnly: true, sameSite: 'lax' }).code(204).send();
  });
}
export async function bootstrapUser(pool: Pool, password: string) {
  const encoded = await hashPassword(password);
  await pool.query('INSERT INTO users(id,password_hash) VALUES($1,$2)', [id('usr'), encoded]);
}
