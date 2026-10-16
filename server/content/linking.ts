import type { News } from '../../src/content/types.js';
import type { Tx } from '../db.js';
export interface LinkCompany { code: string; name: string }
export interface LinkNode { id: string; name: string; aliases: string[] }
export interface SavedNewsLinks { id: string; node_ids: string[]; company_codes: string[] }
export interface LinkContext {
  companies: LinkCompany[]; nodes: LinkNode[];
  exposures: { company_code: string; node_id: string }[]; saved_news: SavedNewsLinks[];
}
// Directory-only nodes are not in this index. Broad labels are not entity names.
const broadLabels = new Set(['行业','产业','公司','企业','材料','设备','服务','产品','其他','综合','上游','下游','制造','生产','业务','市场']);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function literalMatch(text: string, value: string, node = false): boolean {
  const term = value.trim();
  if (term.length < 2 || (node && broadLabels.has(term))) return false;
  if (/^[\x20-\x7e]+$/.test(term)) return new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegex(term)}(?=$|[^A-Za-z0-9])`, 'i').test(text);
  return text.includes(term);
}
function codeMatch(text: string, code: string): boolean {
  // Canonical code only: a bare six-digit amount/date is not a company reference.
  return new RegExp(`(?:^|[^A-Za-z0-9.])${escapeRegex(code)}(?=$|[^A-Za-z0-9.])`, 'i').test(text);
}
/** Only enrich relevance arrays. Never creates/edits a change, evidence or exposure. */
export function linkNews(items: News[], context: LinkContext): News[] {
  const previous = new Map(context.saved_news.map(n => [n.id, n]));
  const exposureNodes = new Map<string, string[]>();
  for (const exposure of context.exposures) {
    const list = exposureNodes.get(exposure.company_code) ?? [];
    list.push(exposure.node_id); exposureNodes.set(exposure.company_code, list);
  }
  return items.map(news => {
    const saved = previous.get(news.id);
    const companies = new Set([...news.company_codes, ...(saved?.company_codes ?? [])]);
    const nodes = new Set([...news.node_ids, ...(saved?.node_ids ?? [])]);
    const text = `${news.title}\n${news.summary ?? ''}`;
    for (const company of context.companies) if (literalMatch(text, company.name) || codeMatch(text, company.code)) companies.add(company.code);
    for (const node of context.nodes) if ([node.name, ...node.aliases].some(name => literalMatch(text, name, true))) nodes.add(node.id);
    // Saved business OR candidate exposure is a related-entity mapping only. Its
    // original role/status/basis remain untouched and explanation still gates business.
    for (const company of companies) for (const node of exposureNodes.get(company) ?? []) nodes.add(node);
    return { ...news, company_codes: [...companies].sort(), node_ids: [...nodes].sort() };
  });
}
export async function enrichNews(tx: Tx, items: News[]): Promise<News[]> {
  if (!items.length) return items;
  // Read only the safe fields needed for exact entity linking, not source bodies,
  // unlicensed text, credentials, or any old model/analysis output.
  const companies = (await tx.query<LinkCompany>("SELECT code,body->>'name' name FROM content_companies ORDER BY code")).rows;
  const nodes = (await tx.query<LinkNode>(`SELECT n.id,n.body->>'name' name,n.body->'aliases' aliases FROM content_nodes n WHERE
    EXISTS(SELECT 1 FROM content_edges e WHERE e.kind<>'classification' AND (e.from_id=n.id OR e.to_id=n.id))
    OR EXISTS(SELECT 1 FROM content_exposures e WHERE e.node_id=n.id AND e.status='business') ORDER BY n.id`)).rows;
  const exposures = (await tx.query<{ company_code: string; node_id: string }>('SELECT company_code,node_id FROM content_exposures ORDER BY company_code,node_id')).rows;
  const saved_news = (await tx.query<SavedNewsLinks>("SELECT id,body->'node_ids' node_ids,body->'company_codes' company_codes FROM content_news WHERE id=ANY($1::text[]) AND origin='bundle'", [items.map(n => n.id)])).rows;
  return linkNews(items, { companies, nodes, exposures, saved_news });
}
