import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../auth.js';
import { transaction, type Pool, type Tx } from '../db.js';
import type { Briefing, Company, CompanyDetail, CompanyExposure, ExposureNode, IndustryDetail, IndustryEdge, IndustryNode, News, NewsDetail, NewsPage, Observation, Overview, Page, Relation } from '../../src/content/types.js';
import { bodies, coverage, mechanismsFor, newsItem, visibleNews } from './store.js';
import { METHODS, missingForNews, verifiedChange, hasVerifiedEvidence } from './methods.js';
import { companyCode, nodeId } from './schema.js';
import { buildBriefing, parseReferenceIds } from './briefing.js';
const querySchema = z.object({ q: z.string().trim().max(200).default(''), industry: nodeId.optional(), company: companyCode.optional(), root: nodeId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40), offset: z.coerce.number().int().min(0).max(1000000).default(0) }).strict();
const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
async function snapshot<T>(pool: Pool, fn: (tx: Tx) => Promise<T>) {
  return transaction(pool, async tx => { await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'); return fn(tx); });
}
function notFound(): never { throw new ApiError(404, 'CONTENT_NOT_FOUND', '内容尚未收录'); }
function newsFilter(query: z.infer<typeof querySchema>) {
  return { sql: `${visibleNews} AND ($1='' OR n.body->>'title' ILIKE $2 OR n.body->>'summary' ILIKE $2)
    AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM content_news_nodes nn WHERE nn.news_id=n.id AND nn.node_id=$3))
    AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM content_news_companies nc WHERE nc.news_id=n.id AND nc.company_code=$4))`,
  values: [query.q, like(query.q), query.industry ?? null, query.company ?? null] };
}
async function newsPage(tx: Tx, query: z.infer<typeof querySchema>): Promise<NewsPage> {
  const f = newsFilter(query);
  const totals = (await tx.query(`SELECT count(*)::int total,max(n.updated_at) updated_at FROM content_news n WHERE ${f.sql}`, f.values)).rows[0];
  const items = await bodies<News>(tx, `SELECT n.body FROM content_news n WHERE ${f.sql} ORDER BY n.published_at DESC NULLS LAST,n.observed_at DESC,n.id LIMIT $5 OFFSET $6`, [...f.values, query.limit, query.offset]);
  return { items: items.map(newsItem), total: totals.total, updated_at: totals.updated_at?.toISOString() ?? null };
}
async function featured(tx: Tx, limit: number): Promise<IndustryNode[]> {
  return bodies(tx, `SELECT n.body FROM content_nodes n WHERE
    EXISTS(SELECT 1 FROM content_edges e WHERE e.kind<>'classification' AND (e.from_id=n.id OR e.to_id=n.id))
    OR EXISTS(SELECT 1 FROM content_exposures e WHERE e.node_id=n.id AND e.status='business')
    ORDER BY (SELECT count(*) FROM content_exposures x WHERE x.node_id=n.id AND x.status='business') DESC,
      (SELECT count(*) FROM content_news_nodes x WHERE x.node_id=n.id) DESC,
      (SELECT count(*) FROM content_edges x WHERE x.kind<>'classification' AND (x.from_id=n.id OR x.to_id=n.id)) DESC,n.id LIMIT $1`, [limit]);
}
export function installContent(app: FastifyInstance, pool: Pool) {
  // installAuth's global preHandler protects these routes; no GET writes or upstream calls.
  const prefix = '/api/v1/content';
  app.get(`${prefix}/methods`, async () => METHODS);
  app.get(`${prefix}/overview`, async (): Promise<Overview> => snapshot(pool, async tx => {
    const c = await coverage(tx);
    return { counts: { industries: c.nodes, relations: c.edges, companies: c.companies, news: c.news, observations: c.observations }, coverage: c,
      recent_news: (await newsPage(tx, querySchema.parse({ limit: 20 }))).items,
      featured_industries: await featured(tx, 10), recent_companies: await bodies<Company>(tx, 'SELECT body FROM content_companies ORDER BY updated_at DESC,code LIMIT 20') };
  }));
  app.get(`${prefix}/news`, async request => snapshot(pool, tx => newsPage(tx, querySchema.parse(request.query))));
  app.get(`${prefix}/news/:id`, async (request): Promise<NewsDetail> => snapshot(pool, async tx => {
    const { id } = z.object({ id: z.string().min(1).max(240) }).parse(request.params);
    const news = (await bodies<News>(tx, `SELECT n.body FROM content_news n WHERE n.id=$1 AND ${visibleNews}`, [id]))[0] ?? notFound();
    const mechanisms = await mechanismsFor(tx, [news]);
    const nodes = [...new Set([...news.node_ids, ...mechanisms.map(m => m.node_id)])];
    const codes = [...new Set([...news.company_codes, ...mechanisms.flatMap(m => m.company_code ? [m.company_code] : [])])];
    return { news: newsItem(news), industries: await bodies<IndustryNode>(tx, 'SELECT body FROM content_nodes WHERE id=ANY($1::text[]) ORDER BY id', [nodes]),
      companies: await bodies<Company>(tx, 'SELECT body FROM content_companies WHERE code=ANY($1::text[]) ORDER BY code', [codes]), mechanisms,
      missing_evidence: missingForNews(news), methods: METHODS };
  }));
  app.get(`${prefix}/industries`, async (request): Promise<Page<IndustryNode>> => snapshot(pool, async tx => {
    const q = querySchema.parse({ limit: 60, ...(request.query as object) });
    // Separate alias avoids shadowing n inside the news permission predicate.
    const finalFilter = `($1='' OR outer_node.body->>'name' ILIKE $2 OR outer_node.body->>'aliases' ILIKE $2 OR outer_node.id ILIKE $2)
      AND ($3::text IS NULL OR outer_node.id=$3 OR EXISTS(SELECT 1 FROM content_node_roots r WHERE r.node_id=outer_node.id AND r.root_id=$3))
      AND ($1<>'' OR $3::text IS NOT NULL OR (NOT EXISTS(SELECT 1 FROM content_edges e WHERE e.kind='classification' AND e.to_id=outer_node.id)
        AND (jsonb_array_length(outer_node.body->'root_ids')=0 OR outer_node.body->'root_ids' @> jsonb_build_array(outer_node.id)))
        OR EXISTS(SELECT 1 FROM content_edges e WHERE e.kind<>'classification' AND (e.from_id=outer_node.id OR e.to_id=outer_node.id))
        OR EXISTS(SELECT 1 FROM content_exposures e WHERE e.node_id=outer_node.id)
        OR EXISTS(SELECT 1 FROM content_news_nodes nn JOIN content_news n ON n.id=nn.news_id WHERE nn.node_id=outer_node.id AND ${visibleNews})
        OR EXISTS(SELECT 1 FROM content_observations o WHERE o.node_id=outer_node.id))`;
    const values = [q.q, like(q.q), q.root ?? null];
    const total = (await tx.query(`SELECT count(*)::int total FROM content_nodes outer_node WHERE ${finalFilter}`, values)).rows[0].total;
    const items = await bodies<IndustryNode>(tx, `SELECT outer_node.body FROM content_nodes outer_node WHERE ${finalFilter} ORDER BY outer_node.body->>'name',outer_node.id LIMIT $4 OFFSET $5`, [...values, q.limit, q.offset]);
    return { items, total };
  }));
  app.get(`${prefix}/industries/:id`, async (request): Promise<IndustryDetail> => snapshot(pool, async tx => {
    const { id } = z.object({ id: nodeId }).parse(request.params);
    const node = (await bodies<IndustryNode>(tx, 'SELECT body FROM content_nodes WHERE id=$1', [id]))[0] ?? notFound();
    const relations = (await tx.query<{ edge: IndustryEdge; node: IndustryNode }>(`SELECT e.body edge,n.body node FROM content_edges e JOIN content_nodes n ON n.id=CASE WHEN e.from_id=$1 THEN e.to_id ELSE e.from_id END WHERE e.from_id=$1 OR e.to_id=$1 ORDER BY e.kind,e.id`, [id])).rows;
    const parents: Relation[] = [], children: Relation[] = [], upstream: Relation[] = [], downstream: Relation[] = [];
    const merged = new Map<string, Relation>();
    for (const relation of relations) {
      const key = JSON.stringify([relation.edge.from_id, relation.edge.to_id, relation.edge.kind]);
      const prior = merged.get(key);
      if (prior) prior.edge.evidence = [...new Map([...prior.edge.evidence, ...relation.edge.evidence].map(e => [JSON.stringify(e), e])).values()];
      else merged.set(key, relation);
    }
    for (const relation of merged.values()) {
      if (relation.edge.kind === 'classification') (relation.edge.to_id === id ? parents : children).push(relation);
      else (relation.edge.to_id === id ? upstream : downstream).push(relation);
    }
    const companies = (await tx.query<CompanyExposure>('SELECT c.body company,e.body exposure FROM content_exposures e JOIN content_companies c ON c.code=e.company_code WHERE e.node_id=$1 ORDER BY e.status,c.code,e.id LIMIT 200', [id])).rows;
    const relevant = [...new Set([id, ...upstream.map(r => r.node.id), ...downstream.map(r => r.node.id)])];
    const news = await bodies<News>(tx, `SELECT n.body FROM content_news n WHERE ${visibleNews} AND
      (EXISTS(SELECT 1 FROM content_news_nodes nn WHERE nn.news_id=n.id AND nn.node_id=$1) OR n.body->'change'->>'node_id'=ANY($2::text[]))
      ORDER BY n.published_at DESC NULLS LAST,n.observed_at DESC,n.id LIMIT 40`, [id, relevant]);
    const observations = await bodies<Observation>(tx, 'SELECT body FROM content_observations WHERE node_id=$1 ORDER BY date DESC,id LIMIT 200', [id]);
    const counts = (await tx.query(`SELECT (SELECT count(*)::int FROM content_exposures WHERE node_id=$1) companies,
      (SELECT count(*)::int FROM content_observations WHERE node_id=$1) observations,
      (SELECT count(*)::int FROM content_news n WHERE ${visibleNews} AND (EXISTS(SELECT 1 FROM content_news_nodes nn WHERE nn.news_id=n.id AND nn.node_id=$1) OR n.body->'change'->>'node_id'=ANY($2::text[]))) news`, [id, relevant])).rows[0];
    return { node, parents, children, upstream, downstream, companies, news: news.map(newsItem), observations,
      mechanisms: (await mechanismsFor(tx, news)).filter(m => m.node_id === id), coverage: { ...counts, completeness: 'observed_only', truncated: counts.companies > companies.length || counts.news > news.length || counts.observations > observations.length }, methods: METHODS };
  }));
  app.get(`${prefix}/companies`, async (request): Promise<Page<Company>> => snapshot(pool, async tx => {
    const q = querySchema.parse(request.query); const values = [q.q, like(q.q)];
    const filter = "($1='' OR code ILIKE $2 OR body->>'name' ILIKE $2 OR body->>'business' ILIKE $2 OR body->>'products' ILIKE $2)";
    const total = (await tx.query(`SELECT count(*)::int total FROM content_companies WHERE ${filter}`, values)).rows[0].total;
    return { total, items: await bodies<Company>(tx, `SELECT body FROM content_companies WHERE ${filter} ORDER BY code LIMIT $3 OFFSET $4`, [...values, q.limit, q.offset]) };
  }));
  app.get(`${prefix}/companies/:code`, async (request): Promise<CompanyDetail> => snapshot(pool, async tx => {
    const { code } = z.object({ code: companyCode }).parse(request.params);
    const company = (await bodies<Company>(tx, 'SELECT body FROM content_companies WHERE code=$1', [code]))[0] ?? notFound();
    const exposures = (await tx.query<ExposureNode>('SELECT e.body exposure,n.body node FROM content_exposures e JOIN content_nodes n ON n.id=e.node_id WHERE e.company_code=$1 ORDER BY e.status,e.node_id,e.id', [code])).rows;
    const nodes = [...new Set(exposures.map(e => e.node.id))];
    const relevant = (await tx.query<{ id: string }>("SELECT unnest($1::text[]) id UNION SELECT from_id FROM content_edges WHERE to_id=ANY($1::text[]) AND kind<>'classification' UNION SELECT to_id FROM content_edges WHERE from_id=ANY($1::text[]) AND kind<>'classification'", [nodes])).rows.map(r => r.id);
    const news = await bodies<News>(tx, `SELECT n.body FROM content_news n WHERE ${visibleNews} AND
      (EXISTS(SELECT 1 FROM content_news_companies nc WHERE nc.news_id=n.id AND nc.company_code=$1)
      OR EXISTS(SELECT 1 FROM content_news_nodes nn WHERE nn.news_id=n.id AND nn.node_id=ANY($2::text[]))
      OR n.body->'change'->>'node_id'=ANY($3::text[])) ORDER BY n.published_at DESC NULLS LAST,n.observed_at DESC,n.id LIMIT 100`, [code, nodes, relevant]);
    const missing: string[] = [];
    if (!company.business.trim()) missing.push('缺少有出处的主营描述');
    if (!hasVerifiedEvidence(company.evidence)) missing.push('缺少可追溯且已核实的公司资料依据');
    if (!company.financials.length) missing.push('缺少有出处财务项，不合成财务数值');
    if (!company.report_period) missing.push('公司报告期未知');
    if (!exposures.some(e => e.exposure.status === 'business')) missing.push('仅有候选或尚无明确业务匹配；不推断公司影响');
    if (!news.some(verifiedChange)) missing.push('待核实触发条件：暂无有可追溯依据的已核实显式变化');
    return { company, exposures, news: news.map(newsItem), mechanisms: (await mechanismsFor(tx, news)).filter(m => m.company_code === code), missing_evidence: missing, methods: METHODS };
  }));
  // Real reuse of mobile_briefing's source/reference/list mapping, without a preset stock pool.
  app.get(`${prefix}/briefing`, async request => snapshot(pool, async tx => {
    const q = z.object({ references: z.string().max(4096).optional(), limit: z.coerce.number().int().min(1).max(20).default(6) }).strict().parse(request.query);
    const refs = parseReferenceIds(q.references); const codes = [...refs];
    if (q.references?.trim() && !refs.size) throw new ApiError(422, 'VALIDATION_FAILED', '公司引用格式应为 ticker:000001.SZ');
    const news = await bodies<News>(tx, `SELECT n.body FROM content_news n WHERE ${visibleNews} AND ($1::boolean OR EXISTS(SELECT 1 FROM content_news_companies nc WHERE nc.news_id=n.id AND nc.company_code=ANY($2::text[]))) ORDER BY n.published_at DESC NULLS LAST,n.observed_at DESC,n.id LIMIT $3`, [!refs.size, codes, q.limit]);
    const companies = await bodies<Company>(tx, 'SELECT body FROM content_companies WHERE code=ANY($1::text[])', [[...new Set(news.flatMap(n => n.company_codes))]]);
    const result: Briefing = buildBriefing(news.map(n => ({ ...n, url:n.url ?? '' })), companies, refs, q.limit);
    return { ...result, data: { ...result.data, items: result.data.items.map(item => ({ ...item, source: { ...item.source, url:item.source.url || null } })) } };
  }));
}
