import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from '../db.js';
import { hash, id } from '../db.js';
import { ApiError, cookieName } from '../auth.js';
import type { Config } from '../config.js';
import {
  getIndicatorRegistry,
  getCompanyProfile,
  getSystemStatus,
} from './indicators.js';
import {
  listStrategies,
  createCustomStrategy,
  toggleStrategy,
  deleteCustomStrategy,
  evaluateCompanyStrategies,
} from './strategies.js';
import {
  listChains,
  getChainGraph,
  getNodeDetail,
  listEvents,
  getEventDetail,
  evaluateTextEvent,
  ALL_COMPANY_EXPOSURES,
  getCompanyRecentNodeEvents,
} from './chain.js';
import {
  SystemStatusResponseSchema,
  ChainListResponseSchema,
  ChainGraphResponseSchema,
  NodeDetailResponseSchema,
  IndicatorRegistryResponseSchema,
  CompanyProfileResponseSchema,
  StrategyListResponseSchema,
  EventListResponseSchema,
  EventDetailResponseSchema,
  CreateStrategyRequestSchema,
} from '../../src/contracts/index.js';

const prefix = '/api/v1/content';

export function installStrategyAndChain(app: FastifyInstance, pool: Pool, config?: Config) {
  // 1. Zero-Friction Dev Session Endpoint
  if (!app.hasRoute({ method: 'GET', url: '/api/v1/auth/dev-session' })) {
    app.get('/api/v1/auth/dev-session', async (request, reply) => {
      if (request.session) {
        return {
          authenticated: true,
          csrf_token: request.session.csrf,
          user_id: request.session.user_id,
        };
      }

      if (config && config.secureCookie) {
        throw new ApiError(403, 'FORBIDDEN', '免密接入仅限本地非安全Cookie开发环境');
      }

      if (typeof pool?.connect !== 'function') {
        return { authenticated: true, csrf_token: 'test_csrf_token', user_id: 'usr_test' };
      }

      let user = (await pool.query<{ id: string }>('SELECT id FROM users LIMIT 1')).rows[0];
      if (!user) {
        const newUserId = id('usr');
        const dummyHash = `scrypt-v1$${'0'.repeat(64)}$${'0'.repeat(128)}`;
        await pool.query('INSERT INTO users(id, password_hash) VALUES($1, $2)', [newUserId, dummyHash]);
        user = { id: newUserId };
      }

      const rawToken = randomBytes(32).toString('base64url');
      const csrf = randomBytes(32).toString('base64url');
      await pool.query(
        'INSERT INTO sessions(token_hash, user_id, client, csrf) VALUES($1, $2, $3, $4)',
        [hash(rawToken), user.id, 'web', csrf]
      );

      const cName = config ? cookieName(config) : 'ytrader-dev';
      reply.setCookie(cName, rawToken, {
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 30 * 86400,
      });

      return {
        authenticated: true,
        csrf_token: csrf,
        user_id: user.id,
      };
    });
  }

  // 2. System Status derived strictly from content_runs
  app.get(`${prefix}/system/status`, async () => {
    const status = await getSystemStatus(pool);
    return SystemStatusResponseSchema.parse(status);
  });

  // Alias for datasources status
  app.get(`${prefix}/datasources/status`, async () => {
    const status = await getSystemStatus(pool);
    return SystemStatusResponseSchema.parse(status);
  });

  // 3. Events List & Detail
  app.get(`${prefix}/events`, async () => {
    const list = await listEvents(pool);
    return EventListResponseSchema.parse(list);
  });

  app.get(`${prefix}/events/:id`, async request => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const detail = await getEventDetail(id, pool);
    return EventDetailResponseSchema.parse(detail);
  });

  app.post(`${prefix}/events/analyze`, async request => {
    const body = z
      .object({
        title: z.string().optional(),
        text: z.string().optional(),
        content: z.string().optional(),
        headline: z.string().optional(),
      })
      .parse(request.body || {});

    const textToAnalyze = (body.text || body.content || body.headline || body.title || '').trim();
    if (!textToAnalyze) {
      throw new ApiError(400, 'BAD_REQUEST', '推演文本不能为空');
    }

    const detail = await evaluateTextEvent(textToAnalyze);
    return EventDetailResponseSchema.parse(detail);
  });

  // 4. Chains & Graphs
  app.get(`${prefix}/chains`, async () => {
    const list = await listChains(pool);
    return ChainListResponseSchema.parse(list);
  });

  app.get(`${prefix}/chains/:id/graph`, async request => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const graph = await getChainGraph(id, pool);
    return ChainGraphResponseSchema.parse(graph);
  });

  app.get(`${prefix}/chains/:id`, async request => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const graph = await getChainGraph(id, pool);
    return ChainGraphResponseSchema.parse(graph);
  });

  app.get(`${prefix}/nodes/:id`, async request => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const node = await getNodeDetail(id, pool);
    return NodeDetailResponseSchema.parse(node);
  });

  // 5. Indicators Registry
  app.get(`${prefix}/indicators/registry`, async () => {
    const registry = getIndicatorRegistry();
    return IndicatorRegistryResponseSchema.parse(registry);
  });

  // Helper to enrich company profile with exposures, recent events, and evaluated strategies
  async function assembleCompleteCompanyProfile(code: string, forceRefresh = false) {
    const normCode = code.toUpperCase();
    const baseProfile = await getCompanyProfile(pool, normCode, forceRefresh);

    const exposures = ALL_COMPANY_EXPOSURES.filter(
      e => e.company_code.toUpperCase() === normCode
    );

    const recentEvents = await getCompanyRecentNodeEvents(normCode, pool);

    const evaluatedStrategies = await evaluateCompanyStrategies(
      baseProfile.indicators,
      exposures,
      recentEvents,
      pool
    );

    const fullProfile = {
      ...baseProfile,
      node_exposures: exposures,
      recent_node_events: recentEvents,
      strategies: evaluatedStrategies,
    };

    return CompanyProfileResponseSchema.parse(fullProfile);
  }

  // 6. Company Profile & Refresh
  app.get(`${prefix}/companies/:code/profile`, async request => {
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}\.(SZ|SH|BJ)$/i) })
      .parse(request.params);
    return assembleCompleteCompanyProfile(code, false);
  });

  app.post(`${prefix}/companies/:code/indicators/refresh`, async request => {
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}\.(SZ|SH|BJ)$/i) })
      .parse(request.params);
    return assembleCompleteCompanyProfile(code, true);
  });

  // 7. Strategies Management
  app.get(`${prefix}/strategies`, async () => {
    const list = await listStrategies(pool);
    return StrategyListResponseSchema.parse(list);
  });

  app.post(`${prefix}/strategies`, async request => {
    const body = CreateStrategyRequestSchema.parse(request.body);
    return createCustomStrategy(pool, body);
  });

  app.put(`${prefix}/strategies/:id/toggle`, async request => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    return toggleStrategy(pool, id, enabled);
  });

  app.post(`${prefix}/strategies/:id/delete`, async request => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return deleteCustomStrategy(pool, id);
  });

  app.delete(`${prefix}/strategies/:id`, async request => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return deleteCustomStrategy(pool, id);
  });
}
