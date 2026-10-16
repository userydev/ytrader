import type { Company, ContentBundle, Evidence, News } from '../../src/content/types.js';
import type { EditorialInput, EditorialSource } from '../../src/content/editorial-types.js';
import type { Item, Ycore } from '../ycore.js';
import { PROMPT_VERSION, refKey } from './editorial-schema.js';
export function permitted(item: Item) { return item.availability === 'available' && item.license_scope.store && item.license_scope.display && item.license_scope.model && Boolean(item.content?.trim()); }
export function eligibleNews(news: News) {
  // Deliberately broad discovery gate; the model makes final financial relevance decisions.
  return Boolean(news.company_codes.length || news.node_ids.length || /公司|股份|产业|营收|利润|订单|回购|注销|董事会|并购|产能|政策|价格|需求|电池|光伏|光模块|半导体|出口|关税|央行|利率|资本|业绩|能源|材料|金融|供应|制造/.test(`${news.title} ${news.summary ?? ''}`));
}
export async function buildInput(bundle: ContentBundle, news: News, core: Pick<Ycore,'item'>, cache = new Map<string, Promise<Item>>()): Promise<EditorialInput | null> {
  const sources = new Map<string,EditorialSource>();
  let remainingBytes=26000;
  const bounded=(text:string,maxBytes:number)=>{
    let result='';let bytes=0;
    for(const char of text){const n=Buffer.byteLength(char,'utf8');if(bytes+n>maxBytes)break;result+=char;bytes+=n;}
    return result;
  };
  const resolve = async (e: Evidence, role: EditorialSource['roles'][number], company?: string): Promise<string | null> => {
    if (!e.source_item_id || !e.source_item_version) return null;
    const key = refKey({ item_id:e.source_item_id, item_version:e.source_item_version });
    let promise = cache.get(key);
    if (!promise) { promise=core.item(e.source_item_id,e.source_item_version); cache.set(key,promise); }
    let item: Item;
    try { item = await promise; } catch { return null; }
    if (item.item_id!==e.source_item_id || item.version!==e.source_item_version || !permitted(item)) return null;
    let source = sources.get(key);
    if (!source) {
      // Only canonical, rights-checked text reaches the gateway. No financial/catalog dumps.
      if(remainingBytes<240)return null;
      const limit=role === 'news' ? 3000 : 1600;
      const position=e.quote ? item.content!.indexOf(e.quote) : -1;
      const start=position>=0 && role!=='news' ? Math.max(0,position-120) : 0;
      let body = item.content!.slice(start,start+limit);
      if (e.quote && item.content!.includes(e.quote) && !body.includes(e.quote)) body = item.content!.slice(position,position+limit);
      body=bounded(body,Math.min(remainingBytes,role==='news'?6000:role==='business'?2600:1800));
      remainingBytes-=Buffer.byteLength(body,'utf8');
      source = { key, item_id:item.item_id, item_version:item.version, title:item.title.slice(0,300), provider:item.source.slice(0,120),
        url:item.url ?? null, published_at:role==='news' ? news.published_at : item.published_at, discovered_at:item.first_seen_at,
        text:body, roles:[], company_codes:[], primary:item.source_classification === 'primary' };
      sources.set(key,source);
    }
    if (!source.roles.includes(role)) source.roles.push(role);
    if (company && !source.company_codes.includes(company)) source.company_codes.push(company);
    return key;
  };
  const newsKeys: string[]=[];
  for (const e of news.evidence.slice(0,3)) { const k=await resolve(e,'news'); if(k && !newsKeys.includes(k)) newsKeys.push(k); }
  if (!newsKeys.length) return null;
  const nodes = new Set(news.node_ids);
  const edges = bundle.edges.filter(e => e.kind !== 'classification' && (nodes.has(e.from_id) || nodes.has(e.to_id))).slice(0,5);
  const nearby = new Set([...nodes,...edges.flatMap(e => [e.from_id,e.to_id])]);
  const businessCodes = bundle.exposures.filter(e => e.status==='business' && nearby.has(e.node_id)).map(e => e.company_code);
  const codes = [...new Set([...news.company_codes,...businessCodes])].slice(0,4);
  const companies: EditorialInput['companies']=[];
  for (const code of codes) {
    const c: Company | undefined=bundle.companies.find(c => c.code===code);
    if (!c) continue;
    const keys: string[]=[];
    // A real company profile is necessary. Exposure labels alone are not business proof.
    for (const e of c.evidence.slice(0,2)) { const k=await resolve(e,'business',code); if(k && !keys.includes(k)) keys.push(k); }
    if (keys.length) companies.push({ code, name:c.name, source_keys:keys });
  }
  const relationships: EditorialInput['relationships']=[];
  for (const edge of edges.slice(0,3)) {
    const keys: string[]=[];
    for (const e of edge.evidence.slice(0,1)) { const k=await resolve(e,'relationship'); if(k) keys.push(k); }
    if (keys.length) relationships.push({ from:bundle.nodes.find(n=>n.id===edge.from_id)?.name ?? edge.from_id,
      to:bundle.nodes.find(n=>n.id===edge.to_id)?.name ?? edge.to_id, kind:edge.kind,source_keys:keys });
  }
  return { prompt_version:PROMPT_VERSION, sources:[...sources.values()].sort((a,b)=>a.key.localeCompare(b.key)), news_keys:newsKeys.sort(), companies, relationships };
}
