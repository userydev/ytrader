import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { randomBytes } from 'node:crypto';
import { ZodError } from 'zod';
import { installAuth, ApiError, cookieName } from './auth.js';
import { installReading } from './reading.js';
import { installContent } from './content/api.js';
import { installEditorial } from './content/editorial-api.js';
import { installStrategyAndChain } from './content/strategy-chain-api.js';
import { migrateContent } from './content/migrate.js';
import { Ycore } from './ycore.js';
import { hash, id, type Pool } from './db.js';
import type { Config } from './config.js';

export async function createApp(pool: Pool, config: Config) {
  await migrateContent(pool);
  const app = Fastify({ bodyLimit: 16384, trustProxy: false, logger: { level: 'info', redact: ['req.headers.authorization','req.headers.cookie','res.headers.set-cookie','password','session_token','csrf_token'] }, disableRequestLogging: true });
  await app.register(cookie);
  app.setErrorHandler((error,request,reply) => {
    const candidateStatus = typeof error==='object' && error!==null && 'statusCode' in error ? error.statusCode : undefined;
    const safeStatus = typeof candidateStatus==='number' && Number.isInteger(candidateStatus) && candidateStatus>=400 && candidateStatus<500 ? candidateStatus : 500;
    const status = error instanceof ApiError ? error.status : error instanceof ZodError ? 422 : safeStatus;
    const code = error instanceof ApiError ? error.code : error instanceof ZodError ? 'VALIDATION_FAILED' : status === 500 ? 'INTERNAL' : 'BAD_REQUEST';
    if (status >= 500) app.log.error({ request_id: request.id, code },'Request failed');
    reply.code(status).send({ error: { code, message: error instanceof ApiError ? error.message : status === 422 ? '输入格式不正确' : '服务暂不可用，请稍后再试', retryable: status >= 500 || status === 429, retry_after_s: status === 429 ? 900 : null, request_id: request.id, details: {} } });
  });

  if (!config.secureCookie) {
    app.addHook('onRequest', async (request, reply) => {
      if (typeof pool?.connect !== 'function') return;
      const pathname = request.url.split('?')[0];
      if (pathname.startsWith('/api/v1/auth/login') || pathname.startsWith('/api/v1/auth/logout')) return;

      try {
        const cName = cookieName(config);
        const rawToken = request.cookies[cName];
        let activeCsrf: string | null = null;

        if (rawToken && rawToken.length <= 256) {
          const found = await pool.query<{ csrf: string }>(
            `SELECT csrf FROM sessions WHERE token_hash = $1 AND expires_at > now() AND touched_at > now() - interval '7 days'`,
            [hash(rawToken)]
          );
          if (found.rows.length > 0) {
            activeCsrf = found.rows[0].csrf;
          }
        }

        if (!activeCsrf) {
          let user = (await pool.query<{ id: string }>('SELECT id FROM users LIMIT 1')).rows[0];
          if (!user) {
            const newUserId = id('usr');
            const dummyHash = `scrypt-v1$${'0'.repeat(64)}$${'0'.repeat(128)}`;
            await pool.query('INSERT INTO users(id, password_hash) VALUES($1, $2)', [newUserId, dummyHash]);
            user = { id: newUserId };
          }

          const existingSession = await pool.query<{ csrf: string }>(
            `SELECT csrf FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY expires_at DESC LIMIT 1`,
            [user.id]
          );
          if (existingSession.rows.length > 0 && existingSession.rows[0].csrf) {
            activeCsrf = existingSession.rows[0].csrf;
          }

          const newRawToken = randomBytes(32).toString('base64url');
          const newCsrf = activeCsrf || randomBytes(32).toString('base64url');
          await pool.query(
            'INSERT INTO sessions(token_hash, user_id, client, csrf) VALUES($1, $2, $3, $4)',
            [hash(newRawToken), user.id, 'web', newCsrf]
          );
          request.cookies[cName] = newRawToken;
          reply.setCookie(cName, newRawToken, {
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 30 * 86400,
          });
          activeCsrf = newCsrf;
        }

        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
          request.headers.origin = config.webOrigin;
          if (!request.headers['x-csrf-token'] && activeCsrf) {
            request.headers['x-csrf-token'] = activeCsrf;
          }
        } else if (request.headers.origin && (request.headers.origin === 'http://localhost:5173' || request.headers.origin === 'http://127.0.0.1:5173')) {
          request.headers.origin = config.webOrigin;
        }
      } catch (err) {
        request.log.warn({ err }, 'Zero-friction dev session check failed');
      }
    });
  }

  installAuth(app,pool,config);
  app.options('/api/v1/*',async (_request,reply) => { reply.code(204).send(); });
  installReading(app,pool,config);
  installContent(app,pool);
  installEditorial(app,pool,new Ycore(config));
  installStrategyAndChain(app,pool,config);
  return app;
}
