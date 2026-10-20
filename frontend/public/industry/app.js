import { createFundamentalsClient, presentFundamentals, supportedSymbol, periodLabel, moneyUnit, TABLE_NAMES, STATE_NAMES } from './fundamentals.js';
import { coreApi, safeReturn } from '../shared/core.js';

let INDUSTRIES = [];
const app = document.querySelector('#app');
const query = new URLSearchParams(location.search);
let industryId = query.get('industry') || '';
let datasets, securities, context, observatory, profiles, data, nodes, companies;
let standaloneSymbol = query.get('symbol') || '', standaloneModel = null, companyRequest = 0;
const panoramaErrors = new Map(), panoramaMeta = new Map();
let layers = { status: true, news: true, companies: false };
let focusedNewsId = null, selection = { type: 'feed' }, search = '', view = 'stages';
let businessHost, currentHost, status, boardObserver, lastBoardWidth = null;
let inspectorHost, inspectorLibrary, inspectorData, inspectorContext = '';
let inspectorState = { tab: 'detail', open: null, scrollTop: 0 };
let panoramaHost, companyHost, detailCompany = null, detailTab = 'overview', panoramaScroll = 0;
let trendKeys = { quick: 'net_profit', detail: 'net_profit' };
const COMPANY_TABS = [['overview', '总览'], ['financials', '财务'], ['business', '业务'], ['announcements', '新闻与公告']];
const TREND_METRICS = [['revenue', '营业收入'], ['net_profit', '归母净利润'], ['operating_cashflow', '经营现金流']];
const CORE_KEYS = ['revenue', 'net_profit', 'roe', 'gross_margin', 'operating_cashflow', 'debt_ratio'];
const NEWS_HOME = '/events';
const NEWS_API = '/api/v1/news/editorial/events/';
let editorial = { id: '', progressId: '', status: 'idle', event: null, error: '' };
let newsRequest = 0, newsController;
let liveEditorial = { status: 'idle', items: [], error: '' };
let dynamicImpact = { key: '', status: 'idle', links: [], message: '', model: '', created_at: '' };
let structureResearch = { key: '', status: 'idle', message: '' };
function openGraph() { return !['gold', 'crude-oil', 'ai-compute', 'innovative-drugs', 'grid'].includes(industryId); }
async function prepareStructure(manual = false) {
  if (!data?.needs_research || (!manual && new URLSearchParams(location.search).get('result') === 'source')) return;
  const key = `${industryId}:${data.version}`;
  if (!manual && structureResearch.key === key) return;
  structureResearch = { key, status: 'loading', message: '正在按主题整理主线、分支与公司角色…' };
  const alive = () => structureResearch.key === key && data?.needs_research && `${industryId}:${data.version}` === key;
  const paint = () => { if (alive()) app.querySelector('.structure-research-state')?.replaceWith(structureResearchState()); };
  paint();
  try {
    const response = await coreApi('/industry-research/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: data.industry.name, source_id: industryId, automatic: !manual }) });
    if (!alive()) return;
    if (response.data.status === 'cached' && response.data.industry_id) { reopenOrganizedStructure(); return; }
    if (!response.data.id) { structureResearch.status = 'error'; structureResearch.message = response.data.message || '此版本已尝试整理，可手动重试。'; paint(); return; }
    const jobId = response.data.id, deadline = Date.now() + 8 * 60 * 1000;
    const poll = async () => {
      if (!alive()) return;
      try {
        const jobs = await coreApi('/jobs');
        if (!alive()) return;
        const job = jobs.data.find(item => item.id === jobId);
        if (job?.status === 'succeeded') { reopenOrganizedStructure(); return; }
        if (job?.status === 'failed' || Date.now() > deadline) { structureResearch.status = 'error'; structureResearch.message = job?.message || '等待较久，可刷新复用任务或手动重试。'; paint(); return; }
        structureResearch.message = job?.message || '正在后台整理产业结构，可离开后重开。'; paint(); setTimeout(poll, 2500);
      } catch (error) { if (alive()) { structureResearch.status = 'error'; structureResearch.message = error.message; paint(); } }
    };
    void poll();
  } catch (error) { if (alive()) { structureResearch.status = 'error'; structureResearch.message = error.message; paint(); } }
}
function reopenOrganizedStructure() {
  const route = new URL(location.href);
  if (route.searchParams.get('result') === 'source') route.searchParams.delete('result');
  route.searchParams.delete('records');
  location.replace(`${route.pathname}${route.search}`);
}
function structureResearchState() {
  return el('section', { class: 'industry-module structure-research-state', role: 'status' }, moduleHeading('主题结构整理', null, 2),
    el('p', {}, structureResearch.message || '此资料尚未形成可展示产业结构。'),
    structureResearch.status !== 'loading' ? button('整理 / 重试并保存结构', 'retry-structure', null, { class: 'text-link' }) : null,
    new URLSearchParams(location.search).get('result') === 'source' ? el('p', {}, el('a', { href: sourceHref(industryId, data.industry.name) }, '退出原始记录视图，进入主题结构 →')) : null,
    el('small', {}, '结果标为 AI 归纳并保存；历史来源不会直接成为供需图。'));
}
// One-shot navigation intent, armed only by an explicit current-event choice.
let pendingEditorialReveal = null;
function revealChosenEditorial() {
  const intent = pendingEditorialReveal;
  if (!intent) return;
  if (intent.industryId !== industryId || intent.id !== editorial.id || intent.progressId !== editorial.progressId ||
      intent.request !== newsRequest || detailCompany || !window.matchMedia('(max-width: 900px)').matches ||
      !['bridge', 'news'].includes(selection.type)) { pendingEditorialReveal = null; return; }
  if (editorial.status === 'loading') return;
  if (editorial.status !== 'ready' || selection.type !== 'news' || selection.id !== editorialNewsId()) { pendingEditorialReveal = null; return; }
  if (intent.scheduled) return;
  intent.scheduled = true;
  requestAnimationFrame(() => {
    if (pendingEditorialReveal !== intent) return;
    pendingEditorialReveal = null;
    if (intent.industryId !== industryId || intent.id !== editorial.id || intent.progressId !== editorial.progressId ||
        intent.request !== newsRequest || editorial.status !== 'ready' || detailCompany ||
        selection.type !== 'news' || selection.id !== editorialNewsId() ||
        !window.matchMedia('(max-width: 900px)').matches || !currentHost?.isConnected) return;
    currentHost.querySelector('.current-identity h2')?.focus({ preventScroll: true });
    window.scrollTo({ top: Math.max(0, window.scrollY + currentHost.getBoundingClientRect().top - 12), behavior: 'auto' });
    storeRoute();
  });
}
function liveNewsItem(item) {
  const graph = datasets?.[industryId];
  const links = (item.industry_links || []).filter(link => link.industry_id === industryId).map(link =>
    openGraph() && (graph?.needs_research || link.source_version !== graph?.version) ? { ...link, node_ids: [] } : link);
  const nodeIds = new Set(datasets[industryId]?.nodes.map(node => node.id) || []);
  return { id: `live:${item.id}`, eventId: item.event_id, progressId: item.id, live: true,
    title: item.title, summary: item.summary, date: item.published_at || '', publisher: (item.publishers || []).join(' / '),
    node_ids: [...new Set(links.flatMap(link => link.node_ids || []).filter(id => nodeIds.has(id)))], company_ids: [],
    impacts: links.flatMap(link => (link.node_ids || []).filter(id => nodeIds.has(id)).map(id => ({ node_id: id, headline: link.variable }))) };
}
function currentIndustryItems() { return liveEditorial.items.filter(item => item.industry_links?.some(link => link.industry_id === industryId)); }
function currentEventsBar() {
  const section = el('section', { class: 'current-editorial-events', 'aria-label': '当前关联新闻' });
  section.append(moduleHeading('当前关联新闻', button('刷新', 'refresh-editorial', null, { class: 'text-link', disabled: liveEditorial.status === 'loading' }), 2));
  const items = currentIndustryItems();
  if (items.length) section.append(el('div', { class: 'current-event-cards' }, ...items.map(item => button([
    el('strong', {}, item.title), el('span', {}, item.industry_links.filter(link => link.industry_id === industryId).map(link => link.variable).join(' / '))
  ], 'current-editorial', item.id, { 'aria-pressed': String(editorial.id === item.event_id && editorial.progressId === item.id) }))));
  else section.append(el('p', { class: 'news-meta', role: 'status' }, liveEditorial.status === 'loading' ? '正在读取当前新闻…' : liveEditorial.status === 'error' ? liveEditorial.error : '暂无当前关联新闻。'));
  return section;
}
async function loadCurrentEditorial() {
  if (liveEditorial.status === 'loading') return;
  liveEditorial = { ...liveEditorial, status: 'loading', error: '' };
  const refresh = () => {
    if (!data || standaloneSymbol || !currentHost) return;
    app.querySelector('.current-editorial-events')?.replaceWith(currentEventsBar());
    updateFocus(selection.type === 'feed');
  };
  refresh();
  try {
    const envelope = await coreApi('/news/editorial');
    if (!Array.isArray(envelope.data?.items) || envelope.data.items.some(item => typeof item.event_id !== 'string' || typeof item.id !== 'string' || !Array.isArray(item.industry_links))) throw new Error('当前新闻格式不符。');
    liveEditorial = { status: 'ready', items: envelope.data.items, error: '' };
  } catch (error) { liveEditorial = { status: 'error', items: [], error: error.message || '当前新闻暂不可用。' }; }
  refresh();
}
function selectCurrentEditorial(item) {
  storeRoute();
  const route = new URL(location.href);
  route.searchParams.set('news', item.event_id); route.searchParams.set('progress', item.id);
  route.searchParams.set('return', `/events?${new URLSearchParams({ event: item.event_id, progress: item.id })}`);
  history.pushState({}, '', route);
  syncEditorialContext(item.event_id); focusEditorial(); layers.news = true;
  showInspector('detail');
  pendingEditorialReveal = window.matchMedia('(max-width: 900px)').matches ?
    { id: item.event_id, progressId: item.id, industryId, request: newsRequest, scheduled: false } : null;
  // Preserve graph controls; only this explicit choice may reveal its ready
  // transmission below the canvas in a stacked, narrow-window layout.
  render(); currentHost.querySelector('h2')?.focus({ preventScroll: true }); storeRoute(); revealChosenEditorial();
}

const fundamentals = createFundamentalsClient(symbol => {
  // Re-read current identity at completion: a response for A never paints B.
  if (!data || !companies) return;
  if (detailCompany && companies.get(detailCompany)?.symbol === symbol) refreshCompanyFinance(companyHost, renderCompanyWorkspace);
  if (selection.type === 'company' && companies.get(selection.id)?.symbol === symbol) refreshCompanyFinance(currentHost, renderCompany);
});
function refreshCompanyFinance(host, renderHost) {
  if (!host) return;
  const focused = document.activeElement, inHost = host.contains(focused);
  const action = focused?.dataset?.action, id = focused?.dataset?.id;
  renderHost();
  if (inHost && !focused.isConnected) {
    const replacement = [...host.querySelectorAll('[data-action]')].find(item => item.dataset.action === action && item.dataset.id === id);
    (replacement || host.querySelector('h1, h2'))?.focus({ preventScroll: true });
  }
}
function financeEntry(id) { return fundamentals.peek(companies.get(id)?.symbol); }
function liveFinance(id) { return presentFundamentals(financeEntry(id).data); }
function ensureFinance(id) { fundamentals.load(companies.get(id)?.symbol); }
function financeState(id) {
  const entry = financeEntry(id), live = entry.data;
  const message = entry.status === 'unsupported' ? '此财务源暂不覆盖该公司；可继续查看业务与产业资料。' :
    entry.status === 'loading' ? '正在读取真实基本面，业务与来源可继续阅读。' :
    entry.status === 'error' ? `${entry.error} 未使用旧财务快照代替。${live ? '以下保留本次浏览上次取得的数据，尚未更新。' : ''}` :
    live?.status === 'unavailable' ? '基本面数据服务未取得可核对数据；未使用旧财务快照代替。' :
    live?.status === 'stale' ? '数据过期或部分缺失，保留来源最近可用值；各表状态与警告见来源。' :
    live && !live.periods.length && !live.composition?.items.length ? '来源暂无数据，尚无可核对基本面；未使用旧财务快照代替。' :
    live?.partial ? '已取得数据，但部分指标或报表缺失；仅展示可核对值，详见来源。' :
    live ? '已取得公开财务数据；空缺不等于零。' : '暂无可核对基本面。';
  return el('div', { class: 'basis-note', role: 'status', 'aria-live': 'polite' }, el('p', {}, message),
    supportedSymbol(companies.get(id)?.symbol) ? button(entry.status === 'loading' ? '正在读取…' : '重试基本面', 'retry-fundamentals', id, { class: 'text-link', disabled: entry.status === 'loading' }) : null);
}
function financeScope(id) {
  const latest = liveFinance(id).latest;
  return `${periodLabel(latest)} · 公司合并整体，非环节财务。收入、利润、现金流为年初累计，非单季、非TTM；资产负债为期末。金额：${moneyUnit(latest?.currency)}；比率：%。`;
}

// This boundary alone adapts the host envelope. No local/static event is substituted.
function editorialText(value) {
  return typeof value === 'string' ? value.trim() : Array.isArray(value) ? value.map(editorialText).filter(Boolean).join('；') : '';
}
function editorialRecords(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.flatMap(item => {
    if (typeof item === 'string') return [{ text: item.trim(), title: '', url: '', publisher: '', date: '' }];
    if (!item || typeof item !== 'object') return [];
    return [{
      text: editorialText(item.text) || editorialText(item.quote) || editorialText(item.summary) || editorialText(item.evidence),
      title: editorialText(item.title), url: editorialText(item.url) || editorialText(item.source_url),
      publisher: editorialText(item.publisher) || editorialText(item.source_name) || editorialText(item.source),
      date: editorialText(item.published_at) || editorialText(item.date)
    }];
  }).filter(item => item.text || item.title || item.url);
}
function adaptEditorialEvent(envelope, requestedId, requestedProgress) {
  const root = envelope?.data;
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('missing');
  const event = root.event && typeof root.event === 'object' && !Array.isArray(root.event) ? root.event : root;
  const returnedId = event.id ?? root.id;
  if (returnedId !== undefined && returnedId !== null && String(returnedId) !== requestedId) throw new Error('mismatch');
  const current = root.current && typeof root.current === 'object' && !Array.isArray(root.current) ? root.current : null;
  const progresses = Array.isArray(root.progresses) ? root.progresses : [];
  const progress = requestedProgress ? [current, ...progresses].find(item => item && typeof item === 'object' && String(item.id) === requestedProgress) : current;
  if (requestedProgress && !progress) throw new Error('progress-missing');
  // A selected progress is its own context. Never substitute another progress's
  // title, associations or reports, including when the requested one is absent.
  const title = progress ? editorialText(progress.title) : editorialText(event.title) || editorialText(root.title);
  if (!title) throw new Error('incomplete');
  const rawLinks = progress ? (Array.isArray(progress.industry_links) ? progress.industry_links : []) : Array.isArray(event.industry_links) ? event.industry_links : Array.isArray(root.industry_links) ? root.industry_links : [];
  return {
    id: requestedId, title, summary: progress ? editorialText(progress.summary) : editorialText(event.summary) || editorialText(root.summary),
    articles: editorialRecords(progress ? progress.articles : event.articles ?? root.articles),
    reports: progress ? progress.articles || [] : root.articles || [],
    links: rawLinks.flatMap(link => {
      if (!link || typeof link !== 'object' || !editorialText(link.industry_id)) return [];
      return [{
        industry_id: editorialText(link.industry_id), industry_name: editorialText(link.industry_name) || editorialText(link.name),
        variable: editorialText(link.variable), mechanism: editorialText(link.mechanism), condition: editorialText(link.condition),
        mechanism_summary: editorialText(link.mechanism_summary), condition_summary: editorialText(link.condition_summary),
        evidence: Array.isArray(link.evidence) ? link.evidence : [],
        mechanism_reference: link.mechanism_reference, basis: link.basis, rule_version: link.rule_version,
        node_ids: Array.isArray(link.node_ids) ? [...new Set(link.node_ids.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))] : [],
        news_version: link.news_version, source_version: link.source_version, impact_version: link.impact_version,
        relation: ['direct', 'conditional', 'association'].includes(link.relation) ? link.relation : 'unspecified'
      }];
    })
  };
}
function safeNewsReturn(value) { return safeReturn(value, NEWS_HOME); }
function editorialNewsId() { return `editorial:${editorial.id}`; }
function editorialLinks() {
  const graph = datasets?.[industryId];
  const original = (editorial.event?.links.filter(link => link.industry_id === industryId) || []).map(link =>
    openGraph() && (!graph || graph.needs_research || link.source_version !== graph.version) ? { ...link, node_ids: [], relation: 'association' } : link);
  return dynamicImpact.key === impactKey() && dynamicImpact.links.length ? [...original.filter(link => link.relation !== 'association'), ...dynamicImpact.links] : original;
}
function impactKey() { return `${industryId}:${editorial.id}:${editorial.progressId}:${datasets?.[industryId]?.version || ''}`; }
async function prepareImpact(force = false) {
  if (!data || data.needs_research || editorial.status !== 'ready' || !editorial.id || standaloneSymbol || new URLSearchParams(location.search).get('result') === 'source') return;
  const key = impactKey();
  if (!force && dynamicImpact.key === key) return;
  dynamicImpact = { key, status: 'loading', links: [], message: '正在结合本条新闻研究实际环节的条件影响…', model: '', created_at: '' };
  const selectedParams = new URLSearchParams(location.search);
  const path = `/industry-research/${encodeURIComponent(industryId)}/impact?${new URLSearchParams({ news: editorial.id, progress: editorial.progressId, offset: selectedParams.get('source_offset') || '0', result: data.research?.selected_result || selectedParams.get('result') || '' })}`;
  const alive = () => key === impactKey() && dynamicImpact.key === key;
  const repaint = () => { if (alive() && currentHost) { updateFocus(); app.querySelector('.news-bridge')?.replaceWith(newsBridgeBar()); } };
  const accept = result => {
    if (!alive()) return;
    dynamicImpact = { key, status: 'ready', links: result.links || [], message: result.links?.length ? '条件推断 · 未核实；并列环节不代表确定因果路径。' : '本版本暂无可定位的条件影响；可结合资料继续研究。', model: result.model || '', created_at: result.created_at || '' };
    repaint();
  };
  repaint();
  try {
    const cached = await coreApi(path);
    if (!alive()) return;
    if (cached.data.model) { accept(cached.data); return; }
    const response = await coreApi(`${path}&automatic=${force ? 'false' : 'true'}`, { method: 'POST' });
    if (!alive()) return;
    if (!response.data.id) {
      if (response.data.status === 'cached') { const saved = await coreApi(path); if (alive()) accept(saved.data); }
      else { dynamicImpact.status = 'idle'; dynamicImpact.message = response.data.message; repaint(); }
      return;
    }
    const jobId = response.data.id, deadline = Date.now() + 8 * 60 * 1000;
    const poll = async () => {
      if (!alive()) return;
      try {
        const response = await coreApi('/jobs');
        if (!alive()) return;
        const job = response.data.find(item => item.id === jobId);
        if (job?.status === 'succeeded') { const saved = await coreApi(path); if (alive()) accept(saved.data); return; }
        if (job?.status === 'failed' || Date.now() > deadline) { dynamicImpact.status = 'error'; dynamicImpact.message = job?.message || '研究等待较久，可稍后重试。'; repaint(); return; }
        setTimeout(poll, 2500);
      } catch (error) { if (alive()) { dynamicImpact.status = 'error'; dynamicImpact.message = error.message; repaint(); } }
    };
    void poll();
  } catch (error) { if (alive()) { dynamicImpact.status = 'error'; dynamicImpact.message = error.message; repaint(); } }
}
function currentEditorialNews() {
  if (editorial.status !== 'ready') return null;
  const links = editorialLinks(), validIds = new Set(datasets[industryId].nodes.map(n => n.id));
  const impacts = links.flatMap(link => link.node_ids.filter(id => validIds.has(id)).map(id => ({
    node_id: id, headline: link.variable || '暂无关联变量信息', reason: link.mechanism,
    watch: link.condition, reasonSummary: link.mechanism_summary, watchSummary: link.condition_summary, relation: link.relation, company_ids: []
  })));
  return { id: editorialNewsId(), title: editorial.event.title, summary: editorial.event.summary,
    date: '', publisher: '新闻雷达 · 动态事件', url: safeNewsReturn(new URLSearchParams(location.search).get('return')),
    external: true, node_ids: [...new Set(impacts.map(i => i.node_id))], company_ids: [], impacts };
}
function editorialStatusText() {
  if (editorial.status === 'loading') return '正在加载新闻，产业图可继续浏览。';
  if (editorial.status === 'error') return editorial.error;
  if (editorial.status !== 'ready') return '';
  const links = editorialLinks(), item = currentEditorialNews();
  if (!editorial.event.links.length) return '暂无相关产业信息。';
  if (!links.length) return `此新闻在「${datasets[industryId].industry.name}」中尚无对应环节，可查看其他关联产业。`;
  if (!item.node_ids.length) return '主题相关；尚无已定位的影响环节，可结合来源资料继续研究。';
  const unknown = [...new Set(links.flatMap(link => link.node_ids))].filter(id => !item.node_ids.includes(id));
  return `已定位 ${item.node_ids.length} 个相关环节。${unknown.length ? `另有 ${unknown.length} 个环节暂不可查看。` : ''}`;
}
function syncEditorialContext(id, force = false) {
  const progressId = new URLSearchParams(location.search).get('progress') || '';
  if (!force && editorial.id === id && editorial.progressId === progressId) return;
  newsController?.abort();
  const request = ++newsRequest;
  editorial = { id, progressId, status: id ? 'loading' : 'idle', event: null, error: '' };
  if (!id) return;
  const controller = newsController = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  (async () => {
    try {
      const response = await fetch(`${NEWS_API}${encodeURIComponent(id)}`, { signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(response.status === 404 ? 'missing' : 'request');
      const event = adaptEditorialEvent(await response.json(), id, progressId);
      if (request !== newsRequest) return;
      editorial = { id, progressId, status: 'ready', event, error: '' };
      if (selection.type === 'bridge') selection = { type: 'news', id: editorialNewsId() };
      if (!focusedNewsId || focusedNewsId === editorialNewsId()) focusedNewsId = editorialNewsId();
    } catch (error) {
      if (request !== newsRequest) return;
      const message = error.message === 'missing' ? '暂未找到此新闻，或新闻已不可用。' :
        error.message === 'mismatch' ? '暂时无法确认此新闻，请重试或返回新闻。' :
        error.message === 'incomplete' ? '此新闻信息不完整，暂无法展示。' :
        error.message === 'progress-missing' ? '暂未找到指定新闻进展，请重试或返回新闻。' :
        '新闻暂时无法加载，请重试或返回新闻。';
      editorial = { id, progressId, status: 'error', event: null, error: `${message} 产业图可继续浏览。` };
      if (focusedNewsId === editorialNewsId()) focusedNewsId = null;
      if (selection.type === 'news' && selection.id === editorialNewsId()) selection = { type: 'bridge' };
    } finally { clearTimeout(timeout); }
    if (request !== newsRequest || !data || standaloneSymbol) return;
    const focused = document.activeElement;
    app.querySelector('.news-bridge')?.replaceWith(newsBridgeBar());
    app.querySelector('.current-editorial-events')?.replaceWith(currentEventsBar());
    updateFocus(); storeRoute();
    if (focused && !focused.isConnected && focused.dataset?.action) [...app.querySelectorAll('[data-action]')].find(button => button.dataset.action === focused.dataset.action && button.dataset.id === focused.dataset.id)?.focus({ preventScroll: true });
    revealChosenEditorial();
    void prepareImpact();
  })();
}
function focusEditorial() {
  if (!editorial.id) return;
  selection = editorial.status === 'ready' ? { type: 'news', id: editorialNewsId() } : { type: 'bridge' };
  focusedNewsId = editorial.status === 'ready' ? editorialNewsId() : null;
}
function editorialIndustryLinks() {
  const ids = [...new Set(editorial.event?.links.map(link => link.industry_id) || [])];
  if (!ids.length) return el('p', { class: 'news-meta' }, '暂无其他关联产业。');
  return el('div', { class: 'bridge-industries', 'aria-label': '此新闻关联产业' }, ...ids.map(id => {
    const industry = INDUSTRIES.find(i => i.id === id), links = editorial.event.links.filter(link => link.industry_id === id);
    const label = industry?.name || links[0].industry_name || id;
    return el('a', { href: sourceHref(id, label), 'aria-current': id === industryId ? 'page' : null }, label);
  }));
}
function newsBridgeBar() {
  if (!editorial.id) return null;
  return el('section', { class: 'news-bridge', 'aria-label': '新闻关联产业' },
    el('div', { class: 'bridge-heading' },
      button(editorial.event?.title || `新闻事件 · ${editorial.id}`, 'bridge-news', null, { class: 'news-title bridge-title' }),
      el('a', { href: safeNewsReturn(new URLSearchParams(location.search).get('return')), class: 'bridge-return' }, '返回新闻 →')),
    editorial.status !== 'ready' || !editorialLinks().length ? el('p', { class: 'bridge-status', role: 'status', 'aria-live': 'polite' }, editorialStatusText()) : null,
    editorial.status === 'ready' && new Set(editorial.event.links.map(link => link.industry_id)).size > 1 ? editorialIndustryLinks() : editorial.status === 'error' ? button('重试读取新闻', 'retry-news', null, { class: 'text-link' }) : null);
}
function editorialSourceList(records) {
  return el('ul', { class: 'bridge-sources' }, ...records.map(record => el('li', {},
    record.title || record.url ? externalLink(record.title || '来源原文', record.url) : null,
    record.text ? el('p', {}, record.text) : null,
    record.publisher || record.date ? el('p', { class: 'news-meta' }, [record.publisher, record.date].filter(Boolean).join(' · ')) : null)));
}
function editorialMappingSection() {
  const transmission = el('core-transmission');
  transmission.context = { links: editorialLinks(), graphs: datasets, title: editorial.event?.title,
    eventId: editorial.id, progressId: editorial.progressId, reports: editorial.event?.reports || [],
    returnTo: `${location.pathname}${location.search}`,
    onNode: id => { if (!nodes.has(id)) return; selection = { type: 'node', id }; showInspector('detail'); updateFocus(); storeRoute(); },
    onCompany: (id, nodeId) => { if (!companies.has(id)) return; selectCompany(id, nodeId); openCompany(id); } };
  return el('section', { class: 'industry-news-impact' },
    dynamicImpact.key === impactKey() ? el('div', { class: 'impact-status', role: 'status' }, el('p', {}, dynamicImpact.message), dynamicImpact.model ? el('small', {}, `${dynamicImpact.model} · ${dynamicImpact.created_at}`) : null,
      dynamicImpact.status !== 'loading' ? button('更新本新闻的条件影响', 'retry-impact', null, { class: 'text-link' }) : null) : null,
    transmission);
}
function renderBridgeState() {
  replacePreservingDetails(currentHost, panelBack(), panelIdentity('新闻详情'),
    el('p', {}, editorialStatusText()), editorial.status === 'error' ? button('重试读取新闻', 'retry-news', null, { class: 'text-link' }) : null,
    el('p', {}, el('a', { href: safeNewsReturn(new URLSearchParams(location.search).get('return')) }, '返回新闻')));
}

// History keeps the panorama context, not just the expanded company's URL.
function snapshot() {
  return { industryId, newsId: editorial.id, progressId: editorial.progressId, layers: { ...layers }, focusedNewsId, selection: { ...selection }, search, view,
    detailCompany, detailTab, panoramaScroll, trendKeys: { ...trendKeys }, inspector: inspectorSnapshot(), scrollY: window.scrollY };
}
function routeSnapshot() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('ytrader:panorama-return') || 'null');
    const state = saved?.state;
    if (saved?.url === `${location.pathname}${location.search}` && state && typeof state === 'object' &&
        typeof state.industryId === 'string' && typeof state.newsId === 'string' && typeof state.progressId === 'string' &&
        typeof state.search === 'string' && ['stages', 'companies'].includes(state.view) &&
        ['feed', 'news', 'node', 'company', 'bridge'].includes(state.selection?.type) &&
        (state.detailCompany === null || typeof state.detailCompany === 'string') &&
        state.layers && ['status', 'news', 'companies'].every(key => typeof state.layers[key] === 'boolean') &&
        Number.isFinite(state.scrollY) && state.scrollY >= 0) return state;
  } catch { /* Storage is optional. */ }
  return null;
}
function storeRoute(push = false) {
  const next = new URL(location.href);
  if (standaloneSymbol) {
    next.searchParams.set('symbol', standaloneSymbol);
    next.searchParams.set('tab', detailTab);
    next.searchParams.set('return', safeReturn(next.searchParams.get('return'), '/securities'));
    history[push ? 'pushState' : 'replaceState']({}, '', next);
    return;
  }
  next.searchParams.set('industry', industryId);
  if (data?.research) next.searchParams.set('result', data.research.selected_result);
  const selectedNode = selection.type === 'node' ? selection.id : selection.type === 'company' ? selection.nodeId : null;
  if (selectedNode) next.searchParams.set('node', selectedNode);
  else next.searchParams.delete('node');
  if (selection.type === 'company') next.searchParams.set('selected_company', selection.id);
  else next.searchParams.delete('selected_company');
  if (next.searchParams.has('return')) next.searchParams.set('return', safeNewsReturn(next.searchParams.get('return')));
  if (detailCompany) { next.searchParams.set('company', detailCompany); next.searchParams.set('tab', detailTab); }
  else { next.searchParams.delete('company'); next.searchParams.delete('tab'); }
  const state = snapshot();
  history[push ? 'pushState' : 'replaceState']({ stockWorkspace: state }, '', next);
  try { sessionStorage.setItem('ytrader:panorama-return', JSON.stringify({ url: `${next.pathname}${next.search}`, state })); } catch { /* Navigation never depends on storage. */ }
}
function restoreRoute(saved) {
  const params = new URLSearchParams(location.search), requested = params.get('company');
  const requestedIndustry = params.get('industry');
  industryId = requestedIndustry || INDUSTRIES[0]?.id;
  if (!datasets[industryId]) { renderPanoramaError(industryId); return; }
  const owner = requested && (INDUSTRIES.find(i => i.id === industryId && datasets[i.id]?.companies.some(c => c.id === requested)) || INDUSTRIES.find(i => datasets[i.id]?.companies.some(c => c.id === requested)));
  if (owner) industryId = owner.id;
  const legacyCompany = owner && datasets[owner.id].companies.find(company => company.id === requested);
  if (legacyCompany && supportedSymbol(legacyCompany.symbol)) {
    const back = new URL(location.href); back.searchParams.delete('company'); back.searchParams.delete('tab'); back.searchParams.set('selected_company', requested);
    const companyParams = new URLSearchParams(params);
    companyParams.delete('company'); companyParams.delete('symbol');
    companyParams.set('return', `${back.pathname}${back.search}`);
    companyParams.set('tab', params.get('tab') || 'overview');
    location.replace(`/securities/${encodeURIComponent(legacyCompany.symbol)}?${companyParams}`);
    return;
  }
  syncEditorialContext(params.get('news')?.trim() || '');
  layers = { status: true, news: true, companies: false };
  focusedNewsId = null; selection = { type: 'feed' }; search = ''; view = 'stages';
  detailCompany = owner ? requested : null; detailTab = COMPANY_TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'overview'; panoramaScroll = 0;
  trendKeys = { quick: 'net_profit', detail: 'net_profit' };
  inspectorState = { tab: params.get('panel') === 'explanation' || params.has('source_offset') || params.get('result') === 'source' ? 'explanation' : 'detail', open: null, scrollTop: 0 };
  const canRestore = saved && saved.industryId === industryId && saved.detailCompany === detailCompany && (saved.newsId || '') === editorial.id && (saved.progressId || '') === editorial.progressId;
  if (canRestore) {
    layers = { ...layers, ...saved.layers }; focusedNewsId = saved.focusedNewsId;
    selection = saved.selection || selection; search = saved.search || ''; view = saved.view === 'companies' ? 'companies' : 'stages';
    detailTab = COMPANY_TABS.some(([key]) => key === saved.detailTab) ? saved.detailTab : 'overview';
    panoramaScroll = saved.panoramaScroll || 0;
    if (['detail', 'news', 'explanation'].includes(saved.inspector?.tab)) inspectorState = {
      tab: saved.inspector.tab, open: Array.isArray(saved.inspector.open) ? saved.inspector.open : null,
      scrollTop: Number.isFinite(saved.inspector.scrollTop) && saved.inspector.scrollTop >= 0 ? saved.inspector.scrollTop : 0
    };
    for (const scope of ['quick', 'detail']) if (TREND_METRICS.some(([key]) => key === saved.trendKeys?.[scope])) trendKeys[scope] = saved.trendKeys[scope];
  } else if (detailCompany) selection = { type: 'company', id: detailCompany };
  else if (params.get('selected_company') && datasets[industryId].companies.some(company => company.id === params.get('selected_company'))) selection = { type: 'company', id: params.get('selected_company'), nodeId: datasets[industryId].nodes.some(node => node.id === params.get('node')) ? params.get('node') : null };
  else if (params.get('node')) selection = { type: 'node', id: params.get('node') };
  else if (editorial.id) focusEditorial();
  const dataset = datasets[industryId];
  if ((selection.type === 'company' && !dataset.companies.some(c => c.id === selection.id)) ||
      (selection.type === 'node' && !dataset.nodes.some(n => n.id === selection.id)) ||
      (selection.type === 'news' && !newsItems().some(n => n.id === selection.id) && selection.id !== editorialNewsId())) selection = { type: 'feed' };
  inspectorData = null;
  render();
  if (requested && !owner) {
    app.querySelector('#main-content').prepend(el('p', { class: 'route-notice', role: 'status' }, '未找到此公司，未选择其他公司。'));
  }
  if (params.get('node') && !dataset.nodes.some(node => node.id === params.get('node'))) app.querySelector('#main-content').prepend(el('p', { class: 'route-notice', role: 'status' }, '未收录指定环节，产业图仍可浏览。'));
  storeRoute();
  const scrollY = saved && saved.industryId === industryId ? saved.scrollY || 0 : 0;
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}
function openCompany(id, tab = 'overview') {
  if (!companies.has(id)) return;
  const symbol = companies.get(id).symbol;
  if (supportedSymbol(symbol)) {
    storeRoute();
    const params = new URLSearchParams({ return: `${location.pathname}${location.search}`, tab, industry: industryId });
    if (data.research) params.set('result', data.research.selected_result);
    if (editorial.id) { params.set('news', editorial.id); if (editorial.progressId) params.set('progress', editorial.progressId); }
    if (selection.nodeId) params.set('node', selection.nodeId);
    location.assign(`/securities/${encodeURIComponent(symbol)}?${params}`);
    return;
  }
  panoramaScroll = window.scrollY;
  storeRoute();
  detailCompany = id; detailTab = COMPANY_TABS.some(([key]) => key === tab) ? tab : 'overview';
  renderCompanyWorkspace(); setWorkspaceVisibility();
  window.scrollTo(0, 0); storeRoute(true); companyHost.querySelector('h1')?.focus({ preventScroll: true });
}
function closeCompany(nextSelection = null) {
  if (standaloneSymbol) { location.assign(safeReturn(new URLSearchParams(location.search).get('return'), '/securities')); return; }
  storeRoute();
  const id = detailCompany;
  detailCompany = null;
  if (nextSelection) selection = nextSelection;
  else if (id) selection = { ...selection, type: 'company', id };
  showInspector('detail'); setWorkspaceVisibility(); updateFocus();
  window.scrollTo(0, panoramaScroll); storeRoute(true);
  (currentHost.querySelector('[data-action="expand-company"]') || currentHost.querySelector('h2'))?.focus({ preventScroll: true });
}
function setWorkspaceVisibility() {
  panoramaHost.hidden = Boolean(detailCompany); companyHost.hidden = !detailCompany;
  document.body.dataset.workspace = detailCompany ? 'company' : 'industry';
  app.querySelector('.title-row').hidden = Boolean(detailCompany);
  app.querySelector('.skip-link').textContent = detailCompany ? '跳到公司工作区' : '跳到产业工作区';
  updatePageTitle();
  if (!detailCompany) { lastBoardWidth = null; layoutSkeleton(); }
}

function updatePageTitle() {
  const tab = COMPANY_TABS.find(([key]) => key === detailTab)?.[1];
  document.title = detailCompany ? `${nameOf(companies.get(detailCompany))} · ${tab} · 公司基本面` : `${data.industry.name}产业全景`;
}

// Local text is never interpreted as markup. Source links accept only HTTP(S).
function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}
function el(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined && value !== false) element.setAttribute(key, String(value));
  append(element, children);
  return element;
}
function svg(tag, attrs = {}, ...children) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  append(element, children);
  return element;
}
function button(text, action, id, attrs = {}) { return el('button', { type: 'button', 'data-action': action, 'data-id': id, ...attrs }, text); }
// Heading level follows context; typography and spacing follow the shared module rule.
function moduleHeading(title, meta = null, level = 3, className = '') {
  return el('div', { class: `module-heading${className ? ` ${className}` : ''}` }, el(`h${level}`, { class: 'module-title' }, title), meta);
}
function externalLink(text, url) {
  try {
    const parsed = new URL(url);
    if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return el('a', { href: parsed.href, target: '_blank', rel: 'noopener noreferrer' }, text);
  } catch { /* Invalid links remain plain text. */ }
  return el('span', {}, text);
}
function nameOf(c) { return securities[c.symbol]?.name || c.name; }
function codeOf(c) { return c.symbol || '证券身份未确认'; }
function partsOf(id) { return data.participations.filter(p => p.company_id === id); }
function partsAt(id) { return data.participations.filter(p => p.node_id === id); }
function nodeInfo(id) { return observatory.industries[industryId].nodes[id] || {}; }
function newsItems() {
  if (standaloneSymbol) return [];
  const items = currentIndustryItems().filter(item => item.event_id !== editorial.id || item.id !== editorial.progressId).map(liveNewsItem);
  const current = currentEditorialNews();
  return current && editorialLinks().length ? [current, ...items] : items;
}
function newsAt(id) { return newsItems().filter(n => n.node_ids.includes(id)); }
function newsItem(id) { return id === editorialNewsId() ? currentEditorialNews() : newsItems().find(n => n.id === id); }
function focusedNews() { return newsItem(focusedNewsId); }
function newsPreviewText(item, id) {
  const headline = item.impacts.find(i => i.node_id === id)?.headline;
  const chars = Array.from(item.title);
  return headline || (chars.length > 22 ? `${chars.slice(0, 22).join('')}…` : item.title);
}
function nodeNewsPreview(id) {
  const focused = focusedNews();
  const isRelated = focused && (focused.node_ids.includes(id) || focused.impacts.some(i => i.node_id === id));
  const item = isRelated ? focused : newsAt(id)[0];
  return item ? { item, text: newsPreviewText(item, id) } : null;
}
function nodeNewsContents(id) {
  const preview = nodeNewsPreview(id), count = newsAt(id).length;
  if (!preview) return [];
  return [
    button(preview.text, 'news', preview.item.id, { class: 'node-news-headline', title: preview.item.title, 'aria-label': `${nodes.get(id).name}：${preview.item.title}` }),
    button(String(count), 'node-news', id, { class: 'node-news-count', 'aria-label': `${nodes.get(id).name}：查看全部${count}条动态`, title: `查看全部${count}条动态` }),
    null
  ];
}
function explicitCompanyIds(n) { return [...new Set([...(n.company_ids || []), ...(n.impacts || []).flatMap(i => i.company_ids || [])])]; }
function selectCompany(id, nodeId = null, gap = false) { selection = { type: 'company', id, nodeId, gap }; }
function orderedNodes() {
  return [...new Set([...data.structure.groups.filter(g => g.role === 'core'), ...data.structure.groups.filter(g => g.role !== 'core')].flatMap(g => g.node_ids))];
}
function activeNodeIds() { return orderedNodes().filter(id => partsAt(id).length); }
function amount(value, digits = 2) { return Number.isFinite(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—'; }
function replacePreservingDetails(host, ...children) {
  const open = new Set([...host.querySelectorAll('details[open][data-key]')].map(d => d.dataset.key));
  host.replaceChildren(); append(host, children);
  host.querySelectorAll('details[data-key]').forEach(d => { d.open = open.has(d.dataset.key); });
}
function productNavigation(active = 'chain') { return el('core-navigation', { active }); }
function renderPanoramaError(id, message = null) {
  data = null;
  app.replaceChildren(productNavigation(), el('main', { id: 'main-content', class: 'load-error', tabindex: '-1' },
    el('h1', {}, '产业资料暂不可用'), el('p', { role: 'status' }, message || panoramaErrors.get(id) || '尚未收录此产业，未改为其他产业。'),
    button('重新读取', 'retry'), el('p', {}, el('a', { href: sourceHref(id, new URLSearchParams(location.search).get('name') || id, true) }, '按此名称开展开放研究 →')), el('p', {}, el('a', { href: safeReturn(new URLSearchParams(location.search).get('return')) }, '返回阅读流程')),
    el('nav', { class: 'related-links', 'aria-label': '其他产业' }, ...INDUSTRIES.map(industry => el('a', { href: `?${new URLSearchParams({ industry: industry.id })}` }, industry.name)))));
}
async function loadDataset(id) {
  const offset = new URLSearchParams(location.search).get('source_offset') || '0';
  const result = new URLSearchParams(location.search).get('result') || '';
  const envelope = await coreApi(`/panorama/${encodeURIComponent(id)}?${new URLSearchParams({ offset, result })}`), raw = envelope.data;
  if (raw?.industry?.id !== id || !Array.isArray(raw.nodes) || !Array.isArray(raw.companies) || !Array.isArray(raw.participations) || !Array.isArray(raw.relations) || !raw.structure) throw new Error('产业身份或结构不符，未回退本地资料。');
  const ids = new Set(raw.nodes.map(node => node.id)), companyIds = new Set(raw.companies.map(company => company.id));
  if (raw.relations.some(relation => !ids.has(relation.from_id) || !ids.has(relation.to_id)) || raw.participations.some(part => !ids.has(part.node_id) || !companyIds.has(part.company_id))) throw new Error('产业引用不完整，未展示错误映射。');
  if (raw.view_context) context.industries[id] = raw.view_context;
  if (raw.view_observatory) observatory.industries[id] = raw.view_observatory;
  if (!context.industries?.[id]?.summary || !observatory.industries?.[id]) throw new Error('此产业的上下文资料缺失，请重试。');
  datasets[id] = raw; panoramaErrors.delete(id); panoramaMeta.set(id, envelope.meta);
}
async function startCompany() {
  const request = ++companyRequest, symbol = standaloneSymbol;
  data = null;
  document.body.dataset.workspace = 'company';
  app.replaceChildren(productNavigation('securities'), el('main', { id: 'main-content', tabindex: '-1' }, el('p', { class: 'boot-message', role: 'status' }, '正在读取公司资料…')));
  try {
    const { loadCompany, loadCompanyMapping } = await import('./company.js');
    const model = await loadCompany(symbol);
    if (request !== companyRequest || standaloneSymbol !== symbol) return;
    standaloneModel = { ...model, mapping: { status: 'loading', roles: [], warnings: [] } };
    industryId = 'company';
    const profile = model.profile;
    const c = { id: symbol, symbol, name: model.security?.name || profile?.name || symbol, profile: profile ? { purpose: profile.introduction ? `${profile.introduction.slice(0, 200)}${profile.introduction.length > 200 ? '…' : ''}` : '', products: profile.business_scope || '', sources: [{ title: profile.source || '公司资料来源', url: profile.source_url }] } : {} };
    data = { industry: { id: industryId, name: '个股' }, nodes: [], companies: [c], participations: [], relations: [] };
    datasets = { [industryId]: data }; companies = new Map([[symbol, c]]); nodes = new Map(); securities = model.security ? { [symbol]: model.security } : {};
    observatory = { industries: { [industryId]: { news: [], nodes: {} } } };
    context = { news: { [symbol]: model.events.map(event => ({ id: event.id, eventId: event.id, title: event.title, summary: event.summary, date: event.published_at || '', publisher: (event.source_names || []).join(' / '), url: `/events?${new URLSearchParams({ event: event.id })}` })) } };
    profiles = { companies: {}, market: { note: '' } };
    detailCompany = symbol;
    const tab = new URLSearchParams(location.search).get('tab');
    detailTab = COMPANY_TABS.some(([key]) => key === tab) ? tab : 'overview';
    companyHost = el('section', { class: 'company-workspace', 'aria-label': '个股详情' });
    const source = el('details', { class: 'workspace-sources' }, el('summary', {}, '公司资料、来源与读取状态'),
      profile ? [el('p', {}, `${profile.source || '来源未提供'} · ${profile.as_of || '资料日期未提供'} · ${profile.status === 'stale' ? '缓存资料，尚未更新' : profile.status === 'unavailable' ? '资料不可用' : '来源资料'}`),
        el('p', {}, profile.introduction || '来源未提供公司简介。'), externalLink('资料原文', profile.source_url)] : el('p', {}, '暂无可核对公司资料。'),
      ...model.warnings.map(warning => el('p', {}, warning)), button('重新读取公司资料', 'retry-company', symbol, { class: 'text-link' }));
    const research = el('core-research', { subject: 'company', identity: symbol });
    app.replaceChildren(productNavigation('securities'), el('a', { class: 'skip-link', href: '#main-content' }, '跳到个股详情'), el('main', { id: 'main-content', tabindex: '-1' }, companyHost, source, research));
    renderCompanyWorkspace(); storeRoute();
    void loadCompanyMapping(symbol).then(mapping => {
      if (request !== companyRequest || standaloneSymbol !== symbol || mapping.symbol !== symbol) return;
      standaloneModel.mapping = mapping;
      refreshCompanyFinance(companyHost, renderCompanyWorkspace);
    }).catch(error => {
      if (request !== companyRequest || standaloneSymbol !== symbol) return;
      standaloneModel.mapping = { status: 'error', roles: [], warnings: [error.message] };
      refreshCompanyFinance(companyHost, renderCompanyWorkspace);
    });
  } catch (error) {
    if (request !== companyRequest) return;
    data = null;
    app.replaceChildren(productNavigation('securities'), el('main', { class: 'load-error' }, el('h1', {}, '公司资料暂不可用'), el('p', { role: 'alert' }, error.message), button('重试', 'retry-company'), el('p', {}, el('a', { href: safeReturn(new URLSearchParams(location.search).get('return'), '/securities') }, '返回个股目录'))));
  }
}
async function start() {
  if (standaloneSymbol) { await startCompany(); return; }
  app.replaceChildren(productNavigation(), el('p', { class: 'boot-message', role: 'status' }, '正在读取产业资料…'));
  try {
    const [catalog, shared] = await Promise.all([coreApi('/panorama/catalog'), coreApi('/panorama/context')]);
    if (!Array.isArray(catalog.data?.items) || catalog.data.items.some(item => typeof item.id !== 'string' || typeof item.name !== 'string')) throw new Error('产业目录格式不符。');
    INDUSTRIES = catalog.data.items;
    if (!INDUSTRIES.length) { renderPanoramaError('', '尚无可用产业资料。'); return; }
    const raw = shared.data;
    if (!raw || !raw.securities || !raw.context || !raw.observatory || !raw.profiles) throw new Error('产业上下文不完整，未回退本地资料。');
    ({ securities, context, observatory, profiles } = raw);
    datasets = {};
    const requested = new URLSearchParams(location.search).get('industry');
    if (!requested) { location.replace('/chain'); return; }
    try { await loadDataset(requested); } catch (error) { panoramaErrors.set(requested, error.message); renderPanoramaError(requested); return; }
    if (!INDUSTRIES.some(industry => industry.id === requested)) INDUSTRIES.push({ id: requested, name: datasets[requested].industry.name });
    restoreRoute(history.state?.stockWorkspace || routeSnapshot());
    void loadCurrentEditorial();
  } catch (error) { renderPanoramaError(industryId, error.message); }
}
function render() {
  if (inspectorData === datasets[industryId]) inspectorState = inspectorSnapshot();
  boardObserver?.disconnect();
  lastBoardWidth = null;
  data = datasets[industryId];
  nodes = new Map(data.nodes.map(n => [n.id, n]));
  companies = new Map(data.companies.map(c => [c.id, c]));
  document.title = `${data.industry.name}产业全景`;
  document.body.classList.toggle('open-graph', openGraph());
  const input = el('input', { id: 'company-search', type: 'search', placeholder: '搜索公司 / 证券代码', autocomplete: 'off', 'aria-label': '搜索已收录公司，保留产业全景', 'aria-describedby': 'search-status' });
  input.value = search;
  input.addEventListener('input', () => { search = input.value.trim().toLowerCase(); updateFocus(false); storeRoute(); });
  status = el('p', { id: 'search-status', class: 'search-status', role: 'status', 'aria-live': 'polite' });
  businessHost = el('div', { class: 'business-host' });
  currentHost = el('div', { class: 'current-detail', 'data-inspector-pane': 'detail' });
  inspectorHost = industryInspector();
  panoramaHost = el('div', { class: `workspace-columns${editorial.id ? ' has-news-context' : ''}` },
    el('div', { class: 'industry-workspace' },
      industrySummary(),
      openGraph() ? (data.needs_research ? structureResearchState() : skeleton()) : (data.structure_gap && data.nodes.length === 1 ? null : skeleton()),
      el('section', { class: 'industry-module business-section', 'aria-label': '公司业务分工' },
        moduleHeading('公司业务分工',
          el('div', { class: 'view-switch', role: 'group', 'aria-label': '业务阅读方式' }, button('按环节看', 'view', 'stages', { 'aria-pressed': 'true' }), button('按公司对照', 'view', 'companies', { 'aria-pressed': 'false' })), 2),
        status, businessHost)), inspectorHost);
  companyHost = el('section', { class: 'company-workspace', 'aria-label': '公司基本面工作区' });
  app.replaceChildren(productNavigation(), el('a', { class: 'skip-link', href: '#main-content' }, '跳到产业工作区'),
    el('header', {},
      el('div', { class: 'nav-row' }, el('h2', {}, '产业链'),
        el('nav', { class: 'industry-switch', 'aria-label': '选择产业' }, el('a', { href: '/chain' }, '搜索全部产业 / 管理跟踪'), ...INDUSTRIES.filter(i => i.id === industryId).map(i => button(i.name, 'industry', i.id, { 'aria-pressed': 'true' })))),
      new URLSearchParams(location.search).has('return') && !editorial.id ? el('p', { class: 'route-notice' }, el('a', { href: safeReturn(new URLSearchParams(location.search).get('return')) }, '← 返回阅读流程')) : null,
      newsBridgeBar(),
      el('div', { class: 'title-row' }, el('h1', {}, `${data.industry.name}${data.structure_gap ? '资料与研究' : '产业全景'}`),
        el('div', { class: 'search-actions' }, input, button('重置', 'reset', null, { class: 'reset-button' })))),
    el('main', { id: 'main-content', tabindex: '-1' },
      panoramaHost, companyHost), footer());
  showInspector(inspectorState.tab);
  renderBusiness(); updateFocus();
  if (detailCompany) renderCompanyWorkspace();
  setWorkspaceVisibility();
  void prepareImpact();
  void prepareStructure();
  if (typeof ResizeObserver !== 'undefined') {
    boardObserver = new ResizeObserver(() => layoutSkeleton());
    const board = app.querySelector('.skeleton-board');
    if (board) boardObserver.observe(board);
  }
}
function inspectorSnapshot() {
  const reading = inspectorLibrary?.querySelector('.inspector-reading');
  return { tab: inspectorState.tab,
    open: reading ? [...reading.querySelectorAll('details')].flatMap((item, index) => item.open ? [index] : []) : inspectorState.open,
    scrollTop: reading && inspectorState.tab === 'explanation' ? reading.scrollTop : inspectorState.scrollTop };
}
function showInspector(tab) {
  if (!['detail', 'news', 'explanation'].includes(tab)) return;
  if (inspectorState.tab === 'explanation' && tab !== 'explanation') inspectorState = inspectorSnapshot();
  inspectorState.tab = tab;
  inspectorHost?.querySelectorAll('[data-inspector-pane]').forEach(pane => { pane.hidden = pane.dataset.inspectorPane !== tab; });
  inspectorHost?.querySelectorAll('[data-action="inspector-tab"]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.id === tab)));
  if (tab === 'explanation') {
    const reading = inspectorLibrary?.querySelector('.inspector-reading');
    if (reading) reading.scrollTop = inspectorState.scrollTop;
  }
}
function industryInspector() {
  // Live selection updates never rebuild the explanation's reading DOM.
  // An explicit news navigation refreshes its links while retaining reading state.
  const contextKey = JSON.stringify([editorial.id, editorial.progressId, new URLSearchParams(location.search).get('return')]);
  if (inspectorData !== data || inspectorContext !== contextKey) {
    inspectorData = data; inspectorContext = contextKey;
    const reading = el('div', { class: 'inspector-reading' }, industryExplanation() || el('p', { class: 'empty-state' }, '暂无产业解释，可结合来源继续研究。'), sourcePanels());
    reading.querySelectorAll('details').forEach((item, index) => {
      if (Array.isArray(inspectorState.open)) item.open = inspectorState.open.includes(index);
    });
    reading.addEventListener('scroll', () => {
      if (reading.isConnected && inspectorState.tab === 'explanation') { inspectorState.scrollTop = reading.scrollTop; storeRoute(); }
    }, { passive: true });
    reading.addEventListener('toggle', () => {
      if (reading.isConnected && inspectorState.tab === 'explanation') storeRoute();
    }, true);
    inspectorLibrary = el('div', { class: 'inspector-library' },
      el('div', { id: 'inspector-news', 'data-inspector-pane': 'news' }, currentEventsBar()),
      el('div', { id: 'inspector-explanation', 'data-inspector-pane': 'explanation' }, reading));
  }
  currentHost.id = 'inspector-detail';
  return el('aside', { class: 'detail-panel', 'aria-label': '产业详情、关联新闻与解释' },
    el('div', { class: 'inspector-navigation', role: 'group', 'aria-label': '右侧阅读内容' },
      ...[['detail', '当前详情'], ['news', '关联新闻'], ['explanation', '产业解释']].map(([id, label]) =>
        button(label, 'inspector-tab', id, { 'aria-controls': `inspector-${id}`, 'aria-pressed': String(inspectorState.tab === id) }))),
    currentHost, inspectorLibrary);
}
function industrySummary() {
  return el('section', { class: 'industry-module industry-summary', 'aria-label': '产业摘要' }, moduleHeading('产业摘要', null, 2),
    ...context.industries[industryId].summary.paragraphs.map(text => el('p', {}, text)));
}
function industryExplanation() {
  const explanation = data.explanation;
  if (!explanation) return null;
  const refs = ids => ids?.length ? el('span', { class: 'explanation-citations' }, ...ids.map(id => {
    const source = data.sources.find(s => s.id === id);
    return source ? externalLink(`[${source.title}]`, source.url) : null;
  })) : null;
  const resultLink = (id, label) => { const p = new URLSearchParams(location.search); p.set('result', id); p.set('panel', 'explanation'); p.delete('node'); p.delete('selected_company'); return el('a', { href: `${location.pathname}?${p}`, 'aria-current': data.research?.selected_result === id ? 'page' : null }, label); };
  return el('section', { class: 'industry-module industry-explanation', 'aria-label': '产业解释' },
    moduleHeading('产业解释', el('span', { class: 'basis-note' }, data.origin === 'ai' ? `AI 知识整理 · ${data.model || '模型见保存记录'}` : '公开参考解释'), 2),
    data.research ? el('div', { class: 'research-answer' }, el('h3', {}, data.research.question),
      el('nav', { class: 'research-answer-history', 'aria-label': '已保存回答' }, resultLink('base', '基础解释'),
        ...data.research.results.map(r => resultLink(r.id, r.question)))) : null,
    data.source_id ? el('p', {}, el('a', { href: `${sourceHref(data.source_id, data.industry.name)}&result=source&records=1` }, '查看未改写的历史来源记录 →')) : null,
    el('p', {}, explanation.overview),
    data.structure.thesis ? el('p', { class: 'structure-thesis' }, data.structure.thesis) : null,
    data.structure.groups.some(group => group.purpose) ? el('details', {}, el('summary', {}, '主线、分支与配套分工'),
      el('ul', {}, ...(data.structure.reading_order || data.structure.groups.map(group => group.id)).map(id => data.structure.groups.find(group => group.id === id)).filter(Boolean).map(group => el('li', {},
        el('strong', {}, `${group.title}${group.role === 'support' ? ' · 配套' : ''}`), el('p', {}, group.purpose || ''),
        el('div', { class: 'explanation-nodes' }, ...group.node_ids.map(id => nodes.has(id) ? button(nodes.get(id).name, 'node', id, { class: 'text-link' }) : null)))))) : null,
    el('ol', { class: 'explanation-steps' }, ...explanation.steps.map(step => el('li', {}, el('h3', {}, step.title), el('p', {}, step.text),
      el('div', { class: 'explanation-nodes' }, ...step.node_ids.map(id => nodes.has(id) ? button(nodes.get(id).name, 'node', id, { class: 'text-link' }) : null)), refs(step.sources)))),
    el('h3', {}, '关键区别'), ...explanation.distinctions.map(item => el('div', {}, el('h4', {}, item.title), el('p', {}, item.text), refs(item.sources))),
    el('h3', {}, '需要核实与继续研究'), el('ul', {}, ...explanation.questions.map(text => el('li', {}, text))),
    el('details', {}, el('summary', {}, '范围与缺口'), el('ul', {}, ...explanation.gaps.map(text => el('li', {}, text)))),
    el('a', { class: 'source-research-cta', href: sourceHref(data.research_industry_id || industryId, data.industry.name, true) }, '输入问题继续研究 →'));
}
function sourceHref(id, name, research = false) {
  const params = new URLSearchParams(location.search);
  ['company', 'symbol', 'tab', 'node', 'source_offset', 'selected_company', 'result', 'industry_id', 'records'].forEach(key => params.delete(key));
  params.set('industry', id); params.set('name', name);
  if (research) params.set('research', '1'); else params.delete('research');
  return `/chain?${params}`;
}
function sourcePanels() {
  const pager = data.product_pagination?.total ? data.product_pagination : data.pagination;
  const pageLink = (offset, label) => { const p = new URLSearchParams(location.search); p.set('source_offset', String(offset)); return el('a', { href: `${location.pathname}?${p}` }, label); };
  return el('details', { class: 'industry-module source-research', 'aria-label': '来源资料与开放研究', open: new URLSearchParams(location.search).has('source_offset') || new URLSearchParams(location.search).get('result') === 'source' },
    el('summary', {}, `来源记录与出处${data.pagination ? ` · ${data.pagination.total} 条` : ''}`),
    data.source_records?.length ? el('div', { class: 'raw-source-records' }, ...data.source_records.map(item => el('article', {},
      el('strong', {}, item.record.product_name || item.record.industry_name || `${item.record.from_entity || item.record.from_industry || ''} → ${item.record.to_entity || item.record.to_industry || ''}`),
      el('p', {}, `${item.historical_names?.join(' / ') || ''} · ${item.record.company_code || ''} · ${item.record.rel || item.kind}`),
      el('small', {}, item.identity_note || '未经语义审查的历史候选资料，非上下游事实'),
      item.current_symbol ? el('a', { href: `/securities/${encodeURIComponent(item.current_symbol)}?${new URLSearchParams({ return: `${location.pathname}${location.search}` })}` }, '查看当前证券（历史业务不作当前角色）') : null,
      el('details', {}, el('summary', {}, '原始记录与全部行号'), el('pre', {}, JSON.stringify({ record: item.record, historical_names: item.historical_names, source_records: item.source_records }, null, 2)))))) : null,
    data.structure_gap ? [moduleHeading('来源结构尚不完整', null, 2), el('p', {}, '分类与主营记录不是完整供需链。先看真实位置，或结合这些资料开展开放研究。')] : null,
    el('a', { href: sourceHref(data.research_industry_id || industryId, data.industry.name, true), class: 'source-research-cta' }, data.origin === 'ai' || data.library_available ? '继续研究这个产业 →' : '结合已有资料研究产业结构 →'),
    data.classifications?.length ? el('details', {}, el('summary', {}, '行业分类 · 非上下游'), el('ul', {}, ...data.classifications.map(item => el('li', {},
      el('a', { href: sourceHref(item.id, item.name) }, item.name), ` — ${item.relation || '分类'} — `,
      el('a', { href: sourceHref(item.parent_id, item.parent) }, item.parent), el('small', {}, JSON.stringify(item.source_record)))))) : null,
    pager?.total > pager?.limit ? el('nav', { class: 'source-pagination', 'aria-label': '来源记录分页' },
      el('span', {}, `历史来源记录 ${pager.offset + 1}—${Math.min(pager.offset + pager.limit, pager.total)} / ${pager.total}`),
      pager.offset > 0 ? pageLink(Math.max(0, pager.offset - pager.limit), '上一页') : null,
      pager.offset + pager.limit < pager.total ? pageLink(pager.offset + pager.limit, '下一页') : null) : null,
    data.neighbor_total > data.nodes.length - 1 ? el('p', { class: 'basis-note' }, '邻居有界展示；点击产品可继续展开对应上下游与公司。') : null);
}
function panoramaPositions() {
  if (data.layout) return data.layout;
  if (!['crude-oil', 'innovative-drugs', 'ai-compute'].includes(industryId)) return Object.fromEntries(data.nodes.map((node, index) => [node.id, [14 + (index % 5) * 182, 78 + Math.floor(index / 5) * 302]]));
  const x = [14, 196, 378, 560, 742];
  if (industryId === 'crude-oil') return { extraction: [x[0], 78], crude: [x[1], 78], refining: [x[2], 78], fuels: [x[3], 78], transport: [x[4], 78], logistics: [x[1], 380], feedstock: [x[3], 380], chemicals: [x[4], 380] };
  if (industryId === 'innovative-drugs') return { discovery: [x[0], 78], preclinical: [x[1], 78], clinical: [x[2], 78], review: [x[3], 78], use: [x[4], 78], cro: [x[1], 380], cdmo: [x[3], 380], commercial: [x[4], 380] };
  return { accelerator: [14, 78], server: [238, 78], cluster: [518, 78], workload: [742, 78], network: [14, 380], storage: [196, 380], software: [378, 380], power: [560, 380], cooling: [742, 380] };
}
function skeletonPath(r, boxes, i) {
  const a = boxes[r.from_id], b = boxes[r.to_id];
  if (r.kind === 'recycles') {
    const below = Math.max(a.y + a.h, b.y + b.h) + 12 + (i % 2) * 12;
    return `M${a.x + a.w / 2},${a.y + a.h} V${below} H${b.x + b.w / 2} V${b.y + b.h + 4}`;
  }
  if (a.y === b.y) {
    if (a.x < b.x) return `M${a.x + a.w},${a.y + a.h / 2} H${b.x - 4}`;
    return `M${a.x},${a.y + a.h / 2} H${b.x + b.w + 4}`;
  }
  const upper = a.y < b.y ? a : b, lower = a.y < b.y ? b : a;
  const mid = (upper.y + upper.h + lower.y) / 2 + ((i % 5) - 2) * 2;
  const start = a.y < b.y ? a.y + a.h : a.y;
  const end = a.y < b.y ? b.y - 4 : b.y + b.h + 4;
  return `M${a.x + a.w / 2},${start} V${mid} H${b.x + b.w / 2} V${end}`;
}
function skeleton() {
  const board = el('div', { class: 'skeleton-board' });
  if (openGraph()) for (const group of data.structure.groups) board.append(el('h3', { class: 'graph-group-heading', 'data-group': group.id }, group.title));
  const edges = svg('svg', { class: 'edge-layer', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    svg('defs', {}, svg('marker', { id: 'chain-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0 L10 5 L0 10z', fill: '#94a0aa' }))));
  data.relations.forEach(r => edges.append(svg('path', { class: `relation-line${r.kind === 'supports' ? ' is-support' : ''}`, 'data-relation': r.id, 'marker-end': 'url(#chain-arrow)' })));
  board.append(edges);
  for (const n of data.nodes) {
    const info = nodeInfo(n.id), metric = info.metrics?.[0];
    const ids = [...new Set(partsAt(n.id).map(p => p.company_id))];
    board.append(el('article', { class: 'skeleton-node', 'data-node': n.id, 'aria-label': n.name },
      button([el('strong', { class: 'node-name' }, n.name), info.flow ? el('span', { class: 'node-flow' }, info.flow) : null], 'node', n.id, { class: 'node-base', 'aria-pressed': 'false' }),
      el('div', { class: 'node-status', 'data-layer': 'status' }, metric ? [
        el('span', { class: 'metric-label' }, metric.label),
        el('span', { class: 'metric-reading' }, metric.value, metric.change ? ` · ${metric.change}` : ''),
        el('span', { class: 'metric-period' }, metric.period)
      ] : null),
      el('div', { class: 'node-news', 'data-layer': 'news' }, nodeNewsContents(n.id)),
      el('div', { class: 'node-companies', 'data-layer': 'companies' }, ids.length ? [companyLink(ids[0], n.id), ids.length > 1 ? button(`+${ids.length - 1}`, 'node', n.id, { 'aria-label': `查看${n.name}的其余${ids.length - 1}家公司` }) : null] : null)));
  }
  return el('section', { class: 'industry-module matrix-skeleton', 'aria-label': '产业链，箭头仅表示产业结构与配套关系' },
    moduleHeading(data.structure_gap ? '已知主营位置 · 待补充结构' : '产业链',
      el('div', { class: 'layer-controls', role: 'group', 'aria-label': '画布信息图层' }, ...[['status', '状态'], ['news', '新闻'], ['companies', '公司']].map(([id, label]) => button(label, 'layer', id, { 'aria-pressed': String(layers[id]) }))), 2),
    data.structure.note ? el('p', { class: 'structure-note' }, data.structure.note) : null,
    openGraph() ? el('p', { class: 'structure-note' }, '分组沿用来源或 AI 解释；总览线按组聚合，选择节点显示该节点全部关系。横向滚动浏览。') : null,
    el('div', { class: openGraph() ? 'grouped-graph-scroll' : 'original-graph' }, board),
    openGraph() ? el('details', { class: 'structure-relations' }, el('summary', {}, `全部关系与出处 · ${data.relations.length} 组${data.source_relations ? ` / ${data.source_relations.length} 条来源公司关系` : ''}`),
      el('ul', {}, ...data.relations.map(r => el('li', {}, nodeLink(r.from_id), ' → ', nodeLink(r.to_id), `：${r.explanation}`,
        r.source_records?.length ? el('details', {}, el('summary', {}, `${r.source_records.length} 条公司/产品原始关系`), el('pre', {}, JSON.stringify(r.source_records, null, 2))) : null))),
      data.source_relations?.length ? el('details', {}, el('summary', {}, '全部来源公司关系（含无法唯一投影的记录）'), el('pre', {}, JSON.stringify(data.source_relations, null, 2))) : null) : null,
    industryId === 'gold' ? el('details', { class: 'structure-relations' }, el('summary', {}, '供给、用途与回收关系'),
      el('ul', {}, ...data.relations.map(r => el('li', {}, `${nodes.get(r.from_id).name} → ${nodes.get(r.to_id).name}：${r.explanation}`)))) : null);
}
function layoutGroupedSkeleton(board) {
  const groups = data.structure.groups, owners = {}, boxes = {}, groupBoxes = {};
  const column = 224, cardWidth = 196, headerY = 76, top = 138;
  const canvasWidth = Math.max(320, groups.length * column + 12);
  board.style.width = `${canvasWidth}px`;
  let canvasHeight = top;
  groups.forEach((group, index) => {
    const x = 12 + index * column;
    groupBoxes[group.id] = { x, y: headerY, w: cardWidth, h: 48 };
    const heading = [...board.querySelectorAll('[data-group]')].find(h => h.dataset.group === group.id);
    const internal = data.relations.filter(r => group.node_ids.includes(r.from_id) && group.node_ids.includes(r.to_id)).length;
    heading.textContent = `${group.title}${internal ? ` · 组内${internal}组关系` : ''}`;
    Object.assign(heading.style, { left: `${x}px`, top: `${headerY}px`, width: `${cardWidth}px` });
    let y = top;
    const ids = [...group.node_ids].sort((a, b) => (Number(nodes.get(a)?.layer) || 0) - (Number(nodes.get(b)?.layer) || 0));
    ids.forEach(id => {
      owners[id] = group.id;
      const card = [...board.querySelectorAll('.skeleton-node')].find(c => c.dataset.node === id);
      if (!card) return;
      Object.assign(card.style, { left: `${x}px`, top: `${y}px`, width: `${cardWidth}px`, height: 'auto' });
      const height = Math.max(44, Math.ceil(card.getBoundingClientRect().height));
      boxes[id] = { x, y, w: cardWidth, h: height };
      y += height + 20;
    });
    canvasHeight = Math.max(canvasHeight, y);
  });
  board.style.height = `${canvasHeight + 8}px`;
  const edgeLayer = board.querySelector('.edge-layer');
  edgeLayer.setAttribute('viewBox', `0 0 ${canvasWidth} ${canvasHeight + 8}`);
  edgeLayer.querySelector('.group-edges')?.remove();
  const focus = selection.type === 'node' ? selection.id : selection.type === 'company' ? selection.nodeId : null;
  board.querySelectorAll('[data-relation]').forEach((edge, index) => {
    const relation = data.relations.find(r => r.id === edge.dataset.relation);
    const visible = focus && [relation.from_id, relation.to_id].includes(focus);
    edge.style.display = visible ? '' : 'none';
    if (!visible) return;
    const a = boxes[relation.from_id], b = boxes[relation.to_id];
    const forward = a.x <= b.x, ax = forward ? a.x + a.w : a.x, bx = forward && a.x !== b.x ? b.x : b.x + b.w;
    const gutter = ax + (forward ? 10 : -10), endGutter = bx + (forward && a.x !== b.x ? -10 : 10);
    const lane = 126 + index % 4 * 2;
    edge.setAttribute('d', a.x === b.x ? `M${ax},${a.y + a.h / 2} H${gutter} V${b.y + b.h / 2} H${bx}` :
      `M${ax},${a.y + a.h / 2} H${gutter} V${lane} H${endGutter} V${b.y + b.h / 2} H${bx}`);
  });
  if (!focus) {
    const aggregate = new Map();
    for (const relation of data.relations) {
      const a = owners[relation.from_id], b = owners[relation.to_id];
      if (a === b) continue;
      const key = `${a}|${b}`;
      if (!aggregate.has(key)) aggregate.set(key, { a, b, count: 0 });
      aggregate.get(key).count++;
    }
    const layer = svg('g', { class: 'group-edges' });
    [...aggregate.values()].forEach(({ a, b, count }, index) => {
      const start = groupBoxes[a], end = groupBoxes[b], lane = 8 + index % 7 * 8;
      const ax = start.x + start.w / 2, bx = end.x + end.w / 2;
      layer.append(svg('path', { class: 'relation-line group-relation-line', d: `M${ax},${headerY} C${ax},${lane} ${bx},${lane} ${bx},${headerY}`, 'marker-end': 'url(#chain-arrow)' },
        svg('title', {}, `${a} → ${b}：${count}组关系，详见全部关系与出处`)));
    });
    edgeLayer.append(layer);
  }
}
function layoutSkeleton() {
  const board = app.querySelector('.skeleton-board');
  if (!board) return;
  if (openGraph()) { layoutGroupedSkeleton(board); return; }
  const width = board.getBoundingClientRect().width;
  if (width <= 0 || width === lastBoardWidth) return;
  // Only inline-size changes invalidate geometry; our own block-size write is ignored by the observer.
  lastBoardWidth = width;
  const positions = panoramaPositions(), cards = [...board.querySelectorAll('.skeleton-node')];
  // Discard every previous explicit size before measuring at the CURRENT width.
  // Invisible layers still take space, so layer toggles cannot alter this natural measurement.
  cards.forEach(card => {
    card.style.left = `${positions[card.dataset.node][0] / 9.2}%`;
    card.style.width = `${164 / 9.2}%`;
    card.style.height = 'auto';
    card.querySelector('.node-news').style.minHeight = '';
  });
  // Reserve the tallest actual news variant, not just the currently focused sentence.
  // Restore text synchronously, before paint; no cloned controls or hidden truncation are needed.
  const items = newsItems();
  cards.forEach(card => {
    const slot = card.querySelector('.node-news'), headline = slot.querySelector('.node-news-headline');
    if (!headline) return;
    const id = card.dataset.node, originalText = headline.textContent;
    let newsHeight = slot.getBoundingClientRect().height;
    for (const item of items.filter(n => n.node_ids.includes(id) || n.impacts.some(i => i.node_id === id))) {
      headline.textContent = newsPreviewText(item, id);
      newsHeight = Math.max(newsHeight, slot.getBoundingClientRect().height);
    }
    headline.textContent = originalText;
    slot.style.minHeight = `${Math.ceil(newsHeight)}px`;
  });
  const height = Math.max(160, ...cards.map(card => Math.ceil(card.getBoundingClientRect().height)));
  const levels = [...new Set(data.nodes.map(n => positions[n.id][1]))].sort((a, b) => a - b);
  const boardHeight = levels.length * (height + 26) + (industryId === 'gold' ? 38 : 8);
  const boxes = Object.fromEntries(data.nodes.map(n => [n.id, { x: positions[n.id][0], y: 4 + levels.indexOf(positions[n.id][1]) * (height + 26), w: 164, h: height }]));
  board.style.height = `${boardHeight}px`;
  board.querySelector('.edge-layer').setAttribute('viewBox', `0 0 920 ${boardHeight}`);
  board.querySelectorAll('.skeleton-node').forEach(card => { card.style.top = `${boxes[card.dataset.node].y}px`; card.style.height = `${height}px`; });
  board.querySelectorAll('[data-relation]').forEach((edge, i) => edge.setAttribute('d', skeletonPath(data.relations.find(r => r.id === edge.dataset.relation), boxes, i)));
}
function participationButton(p) {
  const c = companies.get(p.company_id);
  return button([view === 'stages' ? el('strong', {}, nameOf(c)) : null, el('span', { class: 'role-text' }, p.role)], 'participation', data.participations.indexOf(p), {
    class: 'business-entry', 'data-role-index': data.participations.indexOf(p), 'aria-pressed': 'false'
  });
}
function renderBusiness() {
  const ids = activeNodeIds();
  if (view === 'stages') {
    businessHost.replaceChildren(el('div', { class: 'stage-board', style: `--lanes:${ids.length}` }, ...ids.map(id => el('section', { class: 'stage-lane' },
      el('h3', { 'data-node': id }, button(nodes.get(id).name, 'node', id, { 'aria-pressed': 'false' })),
      el('ul', {}, ...partsAt(id).map(p => el('li', {}, participationButton(p))))))));
  } else {
    const head = el('tr', {}, el('th', { class: 'company-column', scope: 'col' }, '公司 / 证券代码'), ...ids.map(id => el('th', { scope: 'col', 'data-node': id }, button(nodes.get(id).name, 'node', id, { 'aria-pressed': 'false' }))));
    const rows = data.companies.map(c => el('tr', { class: 'company-row', 'data-row-company': c.id },
      el('th', { scope: 'row', class: 'company-column' }, button([el('strong', {}, nameOf(c)), el('span', { class: 'company-code' }, codeOf(c))], 'company', c.id, { 'aria-pressed': 'false' })),
      ...ids.map(id => {
        const parts = partsOf(c.id).filter(p => p.node_id === id);
        return el('td', { 'data-cell-company': c.id, 'data-cell-node': id, class: parts.length ? 'recorded-cell' : 'empty-cell' },
          parts.length ? parts.map(participationButton) : button('·', 'gap', `${c.id}|${id}`, { 'aria-label': `${nameOf(c)} × ${nodes.get(id).name}：查看资料缺口`, title: '未收录，查看资料缺口' }));
      })));
    businessHost.replaceChildren(el('table', { class: 'comparison-table', style: `--lanes:${ids.length}` }, el('caption', { class: 'sr-only' }, '公司与环节对照；空格表示尚未收录，可点击查看资料缺口。'),
      el('colgroup', {}, el('col', { class: 'company-col' }), ...ids.map(() => el('col'))), el('thead', {}, head), el('tbody', {}, ...rows)));
  }
  app.querySelectorAll('[data-action="view"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === view)));
  document.body.dataset.view = view;
}
function matches(c) { return `${nameOf(c)} ${c.name} ${codeOf(c)}`.toLowerCase().includes(search); }
function updateFocus(renderPanel = true) {
  const focused = document.activeElement, wasInPanel = currentHost.contains(focused);
  const focusedNodeId = focused.closest?.('.skeleton-node')?.dataset.node;
  const companyId = selection.type === 'company' ? selection.id : null;
  const nodeId = selection.type === 'node' ? selection.id : selection.type === 'company' ? selection.nodeId : null;
  const selectedNodes = new Set(selection.type === 'company' ? partsOf(companyId).map(p => p.node_id) : selection.type === 'node' ? [selection.id] : []);
  const news = focusedNews(), affected = new Set([...(news?.node_ids || []), ...(news?.impacts || []).map(i => i.node_id)]);
  app.querySelectorAll('[data-node]').forEach(element => {
    element.classList.toggle('is-selected-node', selectedNodes.has(element.dataset.node));
    element.classList.toggle('is-node-focus', nodeId === element.dataset.node);
    element.classList.toggle('is-affected', layers.news && affected.has(element.dataset.node));
  });
  app.querySelectorAll('.skeleton-node').forEach(card => {
    const slot = card.querySelector('.node-news');
    slot.replaceChildren(); append(slot, nodeNewsContents(card.dataset.node));
  });
  lastBoardWidth = null;
  app.querySelectorAll('[data-layer]').forEach(slot => {
    const visible = layers[slot.dataset.layer];
    slot.classList.toggle('is-layer-off', !visible);
    slot.inert = !visible;
    slot.setAttribute('aria-hidden', String(!visible));
  });
  app.querySelectorAll('[data-action="layer"]').forEach(b => b.setAttribute('aria-pressed', String(layers[b.dataset.id])));
  businessHost.querySelectorAll('[data-role-index]').forEach(entry => {
    const p = data.participations[Number(entry.dataset.roleIndex)];
    entry.classList.toggle('is-selected', companyId ? p.company_id === companyId : selection.type === 'node' && p.node_id === nodeId);
    entry.classList.toggle('is-exact', Boolean(companyId && !selection.gap && p.company_id === companyId && p.node_id === nodeId));
    entry.classList.toggle('is-search-match', Boolean(search && matches(companies.get(p.company_id))));
    entry.classList.toggle('is-deemphasized', Boolean(search && !matches(companies.get(p.company_id))));
    entry.setAttribute('aria-pressed', String(companyId === p.company_id));
  });
  businessHost.querySelectorAll('[data-row-company]').forEach(row => {
    row.classList.toggle('is-selected-row', row.dataset.rowCompany === companyId);
    row.classList.toggle('is-search-match', Boolean(search && matches(companies.get(row.dataset.rowCompany))));
  });
  businessHost.querySelectorAll('[data-cell-company]').forEach(cell => cell.classList.toggle('is-gap-focus', Boolean(selection.type === 'company' && selection.gap && cell.dataset.cellCompany === companyId && cell.dataset.cellNode === nodeId)));
  status.textContent = search ? `匹配 ${data.companies.filter(matches).length} 家公司` : '';
  status.hidden = !search;
  if (renderPanel) renderCurrent();
  app.querySelectorAll('[data-action="company"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === companyId)));
  app.querySelectorAll('[data-action="node"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === nodeId)));
  layoutSkeleton();
  if (wasInPanel && !focused.isConnected) {
    const replacement = [...currentHost.querySelectorAll('[data-action]')].find(b => b.dataset.action === focused.dataset.action && b.dataset.id === focused.dataset.id);
    (replacement || currentHost.querySelector('h2'))?.focus({ preventScroll: true });
  } else if (focusedNodeId && !focused.isConnected) {
    const card = [...app.querySelectorAll('.skeleton-node')].find(card => card.dataset.node === focusedNodeId);
    const replacement = [...(card?.querySelectorAll('[data-action]') || [])].find(b => b.dataset.action === focused.dataset.action && b.dataset.id === focused.dataset.id);
    (replacement || card?.querySelector('.node-base'))?.focus({ preventScroll: true });
  }
}
function nodeLink(id) { return button(nodes.get(id).name, 'node', id, { class: 'text-link' }); }
function companyLink(id, nodeId = null) { return button(nameOf(companies.get(id)), 'company', id, { class: 'text-link', 'data-node-id': nodes.has(nodeId) ? nodeId : null }); }
function panelIdentity(title, code) {
  return el('div', { class: 'current-identity' }, el('h2', { tabindex: '-1' }, title), code ? el('p', { class: 'company-code' }, code) : null);
}
function panelBack() { return button(selection.type === 'feed' ? '全部动态' : '动态', 'feed', null, { class: 'feed-back' }); }
function editorialPanelBack() {
  const back = panelBack();
  back.classList.add('editorial-feed-return');
  return [button('← 返回产业图', 'editorial-panorama', null, { class: 'text-link editorial-panorama-return' }), back];
}
function section(title, ...children) { return el('section', { class: 'content-module panel-section' }, moduleHeading(title), ...children); }
function newsMeta(n, linked = false) {
  if (n.external) return null;
  return el('p', { class: 'news-meta' }, el('time', { datetime: n.date }, n.date), n.publisher ? [' · ', linked ? externalLink(n.publisher, n.url) : n.publisher] : null);
}
function newsCard(n, compact = false, level = 4) {
  return el('article', { class: `news-card${focusedNewsId === n.id ? ' is-focused-news' : ''}` },
    newsMeta(n), el(`h${level}`, { class: 'article-title' }, button(n.title, 'news', n.id, { class: 'news-title' })),
    !compact && n.summary ? el('p', {}, n.summary) : null);
}
function renderFeed() {
  const id = selection.filterNodeId, items = id ? newsAt(id) : newsItems();
  replacePreservingDetails(currentHost, id ? panelBack() : null, panelIdentity(id ? `${nodes.get(id).name}动态` : '产业动态'),
    el('div', { class: 'news-list' }, items.length ? items.map(n => newsCard(n, false, 3)) : el('p', { class: 'empty-state' }, '暂无相关动态')));
}
function impactSection(impacts, title = '影响判断', relatedTitle = null) {
  if (!impacts.length) return null;
  return section(title, relatedTitle ? el('h4', {}, relatedTitle) : null, ...impacts.map(i => el('div', { class: 'impact-item' }, nodes.has(i.node_id) ? nodeLink(i.node_id) : null,
      i.headline ? el('h4', {}, i.headline) : null, i.reason ? el('p', {}, i.reason) : null)),
    impacts.some(i => i.watch) ? [el('h4', { class: 'subheading' }, '继续看什么'), el('ul', { class: 'watch-list' }, ...impacts.filter(i => i.watch).map(i => el('li', {}, nodes.has(i.node_id) ? `${nodes.get(i.node_id).name}：` : '', i.watch)))] : null);
}
function renderNews() {
  const n = newsItem(selection.id);
  if (!n) { renderBridgeState(); return; }
  if (n.external) {
    replacePreservingDetails(currentHost, editorialPanelBack(), panelIdentity(n.title),
      editorialMappingSection(),
      el('details', { 'data-key': `news-sources-${editorial.id}` }, el('summary', {}, '报道与来源'), n.summary ? el('p', {}, n.summary) : null, editorialSourceList(editorial.event.articles)),
      el('a', { href: safeNewsReturn(new URLSearchParams(location.search).get('return')), class: 'text-link' }, '返回新闻 →'));
    return;
  }
  const ids = explicitCompanyIds(n).filter(id => companies.has(id));
  replacePreservingDetails(currentHost, panelBack(), panelIdentity(n.title), newsMeta(n, true),
    n.summary ? el('p', { class: 'panel-intro' }, n.summary) : null,
    n.facts?.length ? section('事实', el('ul', { class: 'facts-list' }, ...n.facts.map(f => el('li', {}, f)))) : null,
    impactSection(n.impacts || []),
    ids.length ? section('相关公司', el('div', { class: 'related-links' }, ...ids.map(id => companyLink(id)))) : null);
}
function metricDetail(m) {
  return el('div', { class: 'node-metric' }, el('h4', {}, m.label),
    el('p', { class: 'metric-value' }, m.value, m.change ? el('span', { class: 'metric-change' }, m.change) : null),
    el('p', { class: 'news-meta' }, [m.period, m.scope].filter(Boolean).join(' · ')),
    m.source ? el('p', { class: 'news-meta' }, externalLink(m.source.publisher || '原文', m.source.url), m.source.date ? ` · ${m.source.date}` : '') : null);
}
function renderNode() {
  const n = nodes.get(selection.id), info = nodeInfo(n.id), items = newsAt(n.id), parts = partsAt(n.id);
  replacePreservingDetails(currentHost, panelBack(), panelIdentity(n.name),
    editorial.status === 'ready' && editorialLinks().some(link => link.node_ids.includes(n.id)) ? editorialMappingSection() : null,
    el('p', {}, n.description),
    n.research_id ? el('a', { href: sourceHref(n.research_id, n.name) }, '展开此产品的真实上下游与公司 →') : null,
    data.source_kind ? el('details', {}, el('summary', {}, '位置与关系出处'), ...data.relations.filter(r => r.from_id === n.id || r.to_id === n.id).map(r => el('p', {}, r.explanation, r.source_record ? el('small', {}, JSON.stringify(r.source_record)) : null)), ...parts.map(p => p.source_record ? el('p', {}, companies.get(p.company_id).name, ' · ', JSON.stringify(p.source_record)) : null)) : null,
    info.metrics?.length ? section('已收录指标', el('div', { class: 'node-metrics' }, ...info.metrics.map(metricDetail))) : null,
    info.economics ? el('p', { class: 'node-economics' }, info.economics) : null,
    info.watch?.length ? section('观察变量', el('ul', { class: 'watch-list' }, ...info.watch.slice(0, 2).map(w => el('li', {}, w)))) : null,
    section('相关动态', items.length ? items.map(n => newsCard(n, true)) : el('p', {}, '暂无相关动态')),
    section('参与公司', parts.length ? el('ul', { class: 'node-companies-list' }, ...parts.map(p => el('li', {}, companyLink(p.company_id, n.id), el('p', {}, p.role)))) : el('p', {}, '暂无已收录公司')));
}
function trendModule(id, scope = 'detail', suffix = '') {
  const f = liveFinance(id).trend, key = trendKeys[scope];
  const label = TREND_METRICS.find(([metric]) => metric === key)[1], compact = scope === 'quick';
  const width = compact ? 380 : 560, height = compact ? 184 : 218;
  const left = compact ? 62 : 76, right = width - 12, top = 26, bottom = height - 38;
  const values = f[key], valid = values.filter(Number.isFinite);
  const max = Math.max(0, ...valid), min = Math.min(0, ...valid), range = max - min || 1;
  const high = max + range * .16, low = min < 0 ? min - range * .18 : 0;
  const y = value => top + (high - value) / (high - low) * (bottom - top), zero = y(0);
  const chart = svg('svg', { class: 'trend-chart', viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `${nameOf(companies.get(id))}${label}，单位${moneyUnit(f.currency)}，FY全年累计，零为基线。${f.years.map((year, i) => `${year}年${amount(values[i])}`).join('；')}。` });
  [...new Set([max, 0, min])].forEach(tick => chart.append(
    svg('line', { x1: left, x2: right, y1: y(tick), y2: y(tick), class: tick === 0 ? 'chart-zero' : 'chart-grid' }),
    svg('text', { x: left - 8, y: y(tick) + 4, 'text-anchor': 'end', class: 'chart-tick' }, tick === 0 ? '0' : amount(tick, 1))));
  values.forEach((value, i) => {
    const x = left + (right - left) * (i + .5) / values.length, barWidth = compact ? 34 : 48;
    if (Number.isFinite(value)) {
      const valueY = y(value);
      chart.append(svg('rect', { x: x - barWidth / 2, y: Math.min(valueY, zero), width: barWidth, height: value === 0 ? 1 : Math.abs(valueY - zero),
        class: `trend-bar${value < 0 ? ' is-negative' : ''}${i === values.length - 1 ? ' is-latest' : ''}` }),
      svg('text', { x, y: value < 0 ? valueY + 17 : valueY - 8, 'text-anchor': 'middle', class: 'chart-value' }, amount(value)));
    } else chart.append(svg('text', { x, y: zero - 8, 'text-anchor': 'middle' }, '未收录'));
    chart.append(svg('text', { x, y: height - 10, 'text-anchor': 'middle', class: 'chart-year' }, f.years[i]));
  });
  const controls = el('div', { class: 'trend-switch', role: 'group', 'aria-label': '选择三年趋势指标' },
    ...TREND_METRICS.map(([metric, text]) => button(text, 'trend', metric, { 'data-scope': scope, 'aria-pressed': String(metric === key) })));
  return el('section', { class: `trend-module${suffix === 'financials' ? '' : ' content-module'}${compact ? ' is-compact' : ''}`, 'data-trend-scope': scope, 'data-trend-slot': suffix, 'data-company': id, 'aria-label': '三年经营趋势' },
    moduleHeading('三年经营趋势', el('span', { class: 'unit-note' }, `${f.years.length ? `FY ${f.years[0]}—${f.years.at(-1)}` : '暂无 FY 年报'} · ${moneyUnit(f.currency)}`), suffix === 'financials' ? 4 : 3),
    controls, f.years.length ? el('figure', {}, el('figcaption', { class: 'sr-only' }, label), chart) : el('p', { class: 'basis-note' }, '暂无同币种年报，不以季报或旧快照替代。'),
    el('p', { class: 'basis-note' }, f.note));
}
function gapNotice() {
  if (!selection.gap) return null;
  return el('div', { class: 'gap-notice' }, el('p', {}, `${nameOf(companies.get(selection.id))} × ${nodes.get(selection.nodeId).name}：当前未收录，不代表没有业务。`),
    el('p', {}, '可核对年报、产品目录与公告；所选环节：', nodeLink(selection.nodeId)));
}
function companyNews(id) {
  const items = [...newsItems().filter(n => explicitCompanyIds(n).includes(id)).map(n => ({ ...n, localNewsId: n.id })), ...(context.news[id] || [])];
  const seen = new Set();
  return items.sort((a, b) => b.date.localeCompare(a.date)).filter(n => {
    let key = n.url;
    try { key = new URL(n.url).href; } catch { /* Preserve original key. */ }
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function renderCompany() {
  const { id, nodeId, gap } = selection, c = companies.get(id);
  if (!detailCompany || detailCompany === id) ensureFinance(id);
  const news = companyNews(id), focused = focusedNews();
  const impacts = focused && explicitCompanyIds(focused).includes(id) ? focused.impacts.filter(i => (i.company_ids || []).includes(id)) : [];
  replacePreservingDetails(currentHost, panelBack(), panelIdentity(nameOf(c), codeOf(c)), gapNotice(),
    c.profile?.purpose ? el('p', { class: 'company-purpose' }, c.profile.purpose) : null,
    c.identity_note ? el('p', { class: 'basis-note' }, c.identity_note) : null,
    button(['展开公司详情', el('span', { 'aria-hidden': 'true' }, ' ↗')], 'expand-company', id, { class: 'expand-company' }),
    el('p', { class: 'quote-status' }, profiles.market.note),
    coreMetrics(id, true), observation(id), trendModule(id, 'quick'), segmentOverview(id, true),
    el('details', { class: 'company-details', 'data-key': `quick-source-${id}` }, el('summary', {}, '产业角色与业务资料'),
      el('ul', { class: 'sidebar-roles' }, ...partsOf(id).map(part => el('li', { class: part.node_id === nodeId && !gap ? 'is-exact-role' : '' }, nodeLink(part.node_id), el('p', {}, part.role)))), businessFacts(c)),
    impacts.length ? impactSection(impacts, '相关新闻影响', button(focused.title, 'news', focused.id, { class: 'news-title' })) : null,
    section('新闻与公告', news.length ? news.slice(0, 2).map(n => companyNewsArticle(n)) : el('p', {}, '暂未收录新闻与公告'),
      button('查看全部新闻与公告 →', 'expand-company', id, { class: 'text-link', 'data-tab': 'announcements' })));
}
function metricText(m) { return Number.isFinite(m.value) ? amount(m.value, m.key === 'eps' ? 3 : 2) : '未提供'; }
function coreMetrics(id, compact = false) {
  const p = liveFinance(id), metrics = CORE_KEYS.map(key => p.metrics.find(m => m.key === key)).filter(Boolean);
  return el('section', { class: `content-module core-metrics${compact ? ' is-compact' : ''}`, 'aria-label': '核心财务指标' },
    moduleHeading('核心财务指标', el('span', { class: 'unit-note' }, periodLabel(p.latest))),
    financeState(id), el('p', { class: 'basis-note' }, financeScope(id)),
    el('dl', { class: 'core-grid' }, ...metrics.map(m => el('div', { class: 'core-metric' },
      el('dt', { title: m.definition }, m.label), el('dd', {}, el('strong', { title: metricRaw(m) }, metricText(m)), Number.isFinite(m.value) ? el('span', { class: 'metric-unit' }, m.unit) : null),
      m.change ? el('p', { class: 'metric-yoy' }, m.change) : null,
      m.key === 'net_profit' ? coreProfitComparison(p) : null))),
    el('details', { class: 'metric-definitions', 'data-key': `definitions-${compact ? 'quick' : 'wide'}-${id}` }, el('summary', {}, '指标定义与来源'),
      el('dl', { class: 'definitions-list' }, ...p.metrics.filter(m => CORE_KEYS.includes(m.key) || m.key === 'core_profit').map(m => el('div', {}, el('dt', {}, m.label), el('dd', {}, m.definition)))), profileSource(id)));
}
function metricRaw(m) {
  if (m.derived && Number.isFinite(m.value)) return `${m.definition} 计算结果：${m.value} ${m.unit}`;
  return Number.isFinite(m.raw) ? `来源原值：${m.raw.toLocaleString('zh-CN', { maximumFractionDigits: 8 })} ${m.unit === '%' ? '%' : m.currency || '币种未提供'}` : '来源未提供可核对值；不等于零';
}
function coreProfitComparison(p) {
  const m = p.metrics.find(metric => metric.key === 'core_profit');
  return m ? el('p', { class: 'core-profit-comparison', title: m.definition }, '扣非 ', el('strong', {}, metricText(m)), Number.isFinite(m.value) ? ` ${m.unit}` : null,
    m.change ? el('span', {}, m.change) : null) : null;
}
function observation(id) {
  const p = liveFinance(id), supplied = p.metrics.filter(m => ['revenue', 'net_profit', 'operating_cashflow'].includes(m.key) && Number.isFinite(m.value));
  return el('section', { class: 'content-module company-observation', 'aria-label': '经营观察' }, moduleHeading('经营观察'),
    el('h4', { class: 'observation-focus' }, periodLabel(p.latest)),
    el('p', {}, supplied.length ? `${supplied.map(m => `${m.label} ${metricText(m)} ${m.unit}`).join('；')}（公司整体年初累计）。暂无当前报告期的进一步经营解读，不据此推测原因或单一环节表现。` : '暂无当前报告期可核对指标或经营解读；未沿用旧年度结论。'));
}
function profileSource(id) {
  const entry = financeEntry(id), p = entry.data;
  if (!p) return el('div', { class: 'source-entry' }, financeState(id), el('p', {}, '尚未取得财务数据来源说明，不以本地年报快照代替。'));
  return el('div', { class: 'source-entry' }, externalLink(p.source, p.source_url),
    el('p', {}, `来源状态：${STATE_NAMES[p.status]} · 获取时间：${p.fetched_at || '未提供'}。`),
    el('p', {}, financeScope(id)),
    el('p', {}, '公开数据源表述，未经独立核验。各分表独立获取；同比为来源披露百分数。缺失不跨期补齐，— / 未提供不等于零。'),
    el('ul', {}, ...Object.entries(TABLE_NAMES).map(([key, label]) => {
      const table = p.tables[key];
      return el('li', {}, `${label} · ${STATE_NAMES[table.status]} · 获取：${table.fetched_at || '未提供'}`,
        ...table.source_urls.map((url, index) => [' · ', externalLink(`来源 ${index + 1}`, url)]));
    })),
    p.warnings.length ? el('ul', { class: 'watch-list' }, ...p.warnings.map(warning => el('li', {}, warning))) : el('p', {}, '来源未提供额外警告。'));
}
function segmentBasis(p) {
  const segments = p.segments;
  return el('p', { class: 'basis-note' }, segments ? `${segments.period_end} · 按${segments.basis === 'product' ? '产品 / 业务' : '地区'}分类 · ${moneyUnit(segments.currency)}。独立报告期，不与最新指标混用；占比沿用来源小数比例 × 100，不归一化、不补齐、不强加分母。条形仅在 0—100% 范围示意，数值保留原意。` : '收入构成：暂无可核对的报告期 / 产品或地区数据，不使用旧快照补齐。');
}
function segmentOverview(id, compact = false) {
  const p = liveFinance(id), all = p.segments?.items || [], items = compact ? all.slice(0, 2) : all;
  return el('section', { class: `content-module segment-overview${compact ? ' is-compact' : ''}`, 'aria-label': '业务收入构成' },
    moduleHeading('业务收入构成', el('span', { class: 'unit-note' }, '来源收入占比')),
    segmentBasis(p),
    el('div', { class: 'segment-bars' }, ...items.map(item => el('div', { class: 'segment-row' },
      el('div', { class: 'segment-row-heading' }, el('strong', {}, item.name), el('span', {}, percentText(item.share, 1))),
      el('div', { class: 'segment-track', 'aria-hidden': 'true' }, Number.isFinite(item.share) ? el('div', { class: 'segment-fill', style: `width:${Math.max(0, Math.min(100, item.share))}%` }) : null),
      !compact ? el('p', { class: 'segment-amount' }, Number.isFinite(item.revenue) ? `${amount(item.revenue / 1e8)} ${moneyUnit(p.segments.currency)}` : '收入未提供') : null))),
    p.segments && !items.length ? el('p', { class: 'basis-note' }, '构成表未提供项目。') : null,
    compact ? button('查看完整业务构成 →', 'expand-company', id, { class: 'text-link', 'data-tab': 'business' }) : null);
}
function percentText(value, digits = 2) { return Number.isFinite(value) ? `${amount(value, digits)}%` : '未提供'; }
function businessFacts(c) {
  return el('dl', { class: 'business-facts' }, ...[['products', '产品与服务'], ['buyers', '买方类别'], ['watch', '观察变量'], ['condition', '业务边界']].filter(([key]) => c.profile?.[key]).map(([key, label]) =>
    el('div', {}, el('dt', {}, label), el('dd', {}, c.profile[key]))),
    c.profile?.sources?.length ? el('div', {}, el('dt', {}, '业务来源'), el('dd', {},
      ...c.profile.sources.map(source => el('p', { class: 'source-entry' }, externalLink(source.title, source.url))))) : null);
}
function businessProfile(c) {
  const facts = businessFacts(c);
  return facts.childElementCount ? el('section', { class: 'content-module business-profile' }, moduleHeading('业务资料'), facts) : null;
}
function companyNewsArticle(n, wide = false, level = 4) {
  if (!wide && n.localNewsId) return newsCard(n, false, level);
  return el('article', { class: 'news-card company-news-card' }, newsMeta(n, true), el(`h${level}`, { class: 'article-title' }, n.eventId ? el('a', { href: `/events?${new URLSearchParams({ event: n.eventId, return: `${location.pathname}${location.search}` })}` }, n.title) : externalLink(n.title, n.url)),
    n.summary ? el('p', {}, n.summary) : null,
    wide && n.localNewsId ? button('在产业全景查看影响判断 →', 'company-news', n.localNewsId, { class: 'text-link' }) : null);
}
function companyRoleHref(role) {
  const params = new URLSearchParams({ industry: role.industryId, return: `${location.pathname}${location.search}` });
  if (role.nodeId) params.set('node', role.nodeId);
  if (role.resultId) params.set('result', role.resultId);
  if (role.kind === 'classification') params.set('records', '1');
  if (role.offset) params.set('source_offset', String(role.offset));
  const current = new URLSearchParams(location.search);
  // Carry the event only into its source industry; a company's other roles
  // are independent business references, not new inferred news associations.
  if (current.get('industry') === role.industryId && current.get('news')) {
    params.set('news', current.get('news'));
    if (current.get('progress')) params.set('progress', current.get('progress'));
  }
  return `/industry/index.html?${params}`;
}
function companyResearchEntries(businesses, mapping) {
  const segments = detailCompany ? liveFinance(detailCompany).segments : null;
  const tags = [...new Set([...businesses.map(b => b.label),
    ...(segments?.basis !== 'region' ? (segments?.items || []).map(item => item.name) : []),
    standaloneModel?.profile?.industry].filter(tag => typeof tag === 'string' && tag.trim() && tag.length <= 100 &&
      !/^(?:[A-S]?[、.\s]*制造业|其他|其它|合计|总计|综合|工业|金融业)$/.test(tag.trim())))].slice(0, 8);
  const params = new URLSearchParams(location.search);
  return el('div', { class: 'company-industry-research' },
    el('p', { class: 'basis-note' }, mapping?.roles.length ? '可按真实业务标签继续研究；新研究仍为 AI 解释。' : '未收录位置不代表没有业务。可按来源业务标签开展研究，不视为已证实产业关系。'),
    el('nav', { class: 'related-links', 'aria-label': '按业务开展产业研究' }, ...tags.map(tag => el('a', { href: sourceHref('', tag, true) }, `研究${tag} →`))),
    el('form', { action: '/chain', method: 'get', class: 'company-research-form' },
      el('input', { type: 'hidden', name: 'research', value: '1' }),
      el('input', { type: 'hidden', name: 'return', value: `${location.pathname}${location.search}` }),
      ...['news', 'progress'].filter(key => params.get(key)).map(key => el('input', { type: 'hidden', name: key, value: params.get(key) })),
      el('input', { type: 'text', name: 'name', required: true, maxlength: '100', placeholder: '按公司资料输入产品或业务', 'aria-label': '要研究的真实业务或产品' }),
      el('button', { type: 'submit' }, '开展产业研究')));
}
function companyRoles(id, wide = false) {
  if (standaloneSymbol) {
    const businesses = standaloneModel?.profile?.businesses || [], mapping = standaloneModel?.mapping;
    return el('section', { class: 'content-module company-roles' }, moduleHeading('业务与产业位置'),
      mapping?.roles.length ? el('ul', { class: 'role-list' }, ...mapping.roles.map(role => el('li', {},
        el('a', { href: companyRoleHref(role) }, role.nodeName === role.industryName ? role.industryName : `${role.industryName} / ${role.nodeName}`), el('p', {}, `${role.kind === 'ai' ? 'AI 解释 · ' : role.kind === 'classification' ? '行业分类 · ' : role.kind === 'business' ? '主营记录 · ' : '资料位置 · '}${role.role}`)))) :
        el('p', { class: 'basis-note', role: 'status' }, mapping?.status === 'loading' ? '正在核对产业环节…' : mapping?.status === 'error' || mapping?.warnings.length ? '产业位置暂不可用。' : '暂未收录产业位置。'),
      businesses.length ? el('details', {}, el('summary', {}, '资料源收录的业务'), el('ul', {}, ...businesses.map(business => el('li', {}, business.label)))) : null,
      companyResearchEntries(businesses, mapping),
      mapping?.roles.length || mapping?.warnings.length ? el('details', {}, el('summary', {}, '产业资料来源'),
        el('p', {}, '产业结构资料仅作业务参考，不代表当前收入占比或最新经营结论。'),
        ...(mapping.roles || []).map(role => el('div', {}, el('p', {}, `${role.industryName} · ${role.source || '来源未提供'} · ${role.asOf || '资料日期未提供'}`),
          ...role.sources.map(source => el('p', {}, externalLink(source.title, source.url), ` · ${source.locator || ''}`)),
          role.sourceRecord ? el('small', {}, JSON.stringify(role.sourceRecord)) : null)),
        ...(mapping.warnings || []).map(warning => el('p', {}, warning))) : null);
  }
  const parts = partsOf(id);
  return el('section', { class: 'content-module company-roles' }, moduleHeading('产业链角色'),
    parts.length ? el('ul', { class: 'role-list' }, ...parts.map(p => el('li', {},
      button(nodes.get(p.node_id).name, wide ? 'company-role' : 'node', p.node_id, { class: 'text-link' }), el('p', {}, p.role)))) : el('p', { class: 'basis-note' }, '暂未收录产业角色'));
}
function metricGroup(id, group, title, description) {
  const p = liveFinance(id), items = p.metrics.filter(m => m.group === group);
  return el('section', { class: 'content-module finance-group' }, moduleHeading(title), el('p', { class: 'group-description' }, description),
    el('table', { class: 'group-table' }, el('caption', { class: 'sr-only' }, `${title} · ${periodLabel(p.latest)}`),
      el('colgroup', {}, el('col', { class: 'metric-name-col' }), el('col', { class: 'metric-number-col' }), el('col')),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '指标'), el('th', { scope: 'col' }, p.latest ? `${p.latest.period_type} · ${p.latest.period_end}` : '暂无报告期'), el('th', { scope: 'col' }, '定义 / 口径'))),
      el('tbody', {}, ...items.map(m => el('tr', {}, el('th', { scope: 'row' }, m.label),
        el('td', { class: 'group-value' }, el('strong', { title: metricRaw(m) }, metricText(m)), Number.isFinite(m.value) ? el('span', { class: 'metric-unit' }, m.unit) : null,
          m.change ? el('span', { class: 'metric-yoy' }, m.change) : null),
        el('td', { class: 'metric-definition' }, m.definition))))));
}
function segmentTable(id) {
  const p = liveFinance(id), segments = p.segments;
  const kind = segments?.basis === 'region' ? '地区' : '产品 / 业务';
  return el('section', { class: 'content-module segment-table-section' }, moduleHeading(`${kind}收入与盈利`), segmentBasis(p),
    el('table', { class: 'segment-table' }, el('caption', { class: 'sr-only' }, `${segments?.period_end || '暂无报告期'}收入构成、来源占比与毛利率`),
      el('thead', {}, el('tr', {}, ...[kind, `收入（${moneyUnit(segments?.currency)}）`, '收入占比', '毛利率'].map(text => el('th', { scope: 'col' }, text)))),
      el('tbody', {}, ...(segments?.items || []).map(item => el('tr', {}, el('th', { scope: 'row' }, item.name),
        el('td', { title: Number.isFinite(item.revenue) ? `${item.revenue} ${segments.currency}` : '来源未提供' }, Number.isFinite(item.revenue) ? amount(item.revenue / 1e8) : '未提供'),
        el('td', {}, percentText(item.share)), el('td', {}, percentText(item.gross_margin)))))));
}
function companyTabHeading(key, meta = null) {
  return moduleHeading(COMPANY_TABS.find(([tab]) => tab === key)[1], meta, 2, 'tab-heading');
}
function latestCompanyNews(items) {
  return el('section', { class: 'content-module overview-latest' },
    moduleHeading('最新新闻与公告', button('全部 →', 'company-tab', 'announcements', { class: 'text-link' })),
    items.length ? companyNewsArticle(items[0], true) : el('p', { class: 'basis-note' }, '暂未收录新闻与公告'));
}
function companyNewsContext() {
  const params = new URLSearchParams(location.search), news = params.get('news');
  if (!news) return null;
  const newsParams = new URLSearchParams({ event: news });
  if (params.get('progress')) newsParams.set('progress', params.get('progress'));
  const roles = standaloneModel?.mapping?.roles || [];
  const role = roles.find(role => role.industryId === params.get('industry') && role.nodeId === params.get('node') && (!params.get('result') || role.resultId === params.get('result')));
  const graphParams = role ? new URLSearchParams({ industry: role.industryId, node: role.nodeId, news, return: `${location.pathname}${location.search}` }) : null;
  if (graphParams && params.get('progress')) graphParams.set('progress', params.get('progress'));
  if (graphParams && role.resultId) graphParams.set('result', role.resultId);
  if (graphParams && role.offset) graphParams.set('source_offset', String(role.offset));
  return el('nav', { class: 'company-news-context', 'aria-label': '本次新闻阅读上下文' },
    el('a', { href: `/events?${newsParams}` }, '阅读本次新闻 →'),
    role ? el('a', { href: `/industry/index.html?${graphParams}` }, `${role.industryName} / ${role.nodeName} →`) : null);
}
function renderCompanyWorkspace() {
  const id = detailCompany, c = companies.get(id), p = profiles.companies[id];
  if (!c) return;
  ensureFinance(id);
  const live = liveFinance(id), f = live.trend, latest = live.latest;
  const items = companyNews(id);
  const overview = el('section', { class: 'company-tab-panel', id: 'company-overview', 'data-company-panel': 'overview', 'aria-labelledby': 'company-nav-overview' },
    companyTabHeading('overview'),
    el('div', { class: 'company-overview-grid' },
      el('div', { class: 'overview-primary' }, coreMetrics(id), observation(id), trendModule(id, 'detail', 'overview')),
      el('div', { class: 'overview-secondary' }, segmentOverview(id), companyRoles(id, true), latestCompanyNews(items))));
  const financialPanel = el('section', { class: 'company-tab-panel', id: 'company-financials', 'data-company-panel': 'financials', 'aria-labelledby': 'company-nav-financials' },
    companyTabHeading('financials', el('span', { class: 'unit-note' }, periodLabel(latest))),
    financeState(id), el('p', { class: 'basis-note' }, financeScope(id)),
    el('div', { class: 'finance-groups' },
        metricGroup(id, 'growth', '规模与增长', '公司整体年初累计；同比沿用来源，不跨报告期填补缺失。'),
        metricGroup(id, 'profitability', '盈利能力', '来源报告期比率与基本每股收益；未提供的字段不推算。'),
        metricGroup(id, 'cash', '现金与利润', '经营现金流为年初累计；与归母利润口径不同，不单独据此判断盈利质量。'),
        metricGroup(id, 'balance', '资产与负债', '期末存量，不是全年发生额。'),
        metricGroup(id, 'investment', '研发投入', '未取得可核对的研发投入数据，不使用旧快照代替。')),
      el('section', { class: 'content-module historical-finance' }, moduleHeading('三年可比数据'), el('div', { class: 'history-grid' },
        el('div', {}, moduleHeading('年度财务数据', null, 4), financialTable(c, f), financialSource(f)), trendModule(id, 'detail', 'financials'))),
      el('details', { class: 'workspace-sources', 'data-key': `full-source-${id}` }, el('summary', {}, '年报原文与口径说明'), profileSource(id)));
  const businessPanel = el('section', { class: 'company-tab-panel', id: 'company-business', 'data-company-panel': 'business', 'aria-labelledby': 'company-nav-business' },
    companyTabHeading('business'),
    el('div', { class: 'business-detail-grid' },
      el('div', {}, financeState(id), segmentOverview(id), segmentTable(id), el('details', { class: 'workspace-sources', 'data-key': `business-source-${id}` }, el('summary', {}, '业务数据来源'), profileSource(id))),
      el('div', { class: 'business-context' }, companyRoles(id, true), businessProfile(c))));
  const announcements = el('section', { class: 'company-tab-panel announcements-panel', id: 'company-announcements', 'data-company-panel': 'announcements', 'aria-labelledby': 'company-nav-announcements' },
    companyTabHeading('announcements', el('span', { class: 'unit-note' }, '按发布日期排序')),
    el('section', { class: 'content-module annual-report-link' }, moduleHeading('年报原文与口径说明'), financeState(id),
      el('details', { class: 'workspace-sources', 'data-key': `announcements-source-${id}` }, el('summary', {}, '当前财务数据来源与完整性'), profileSource(id)),
      p ? [externalLink(p.source.title, p.source.url), el('p', { class: 'basis-note' }, `历史资料截至 ${profiles.as_of} · ${p.source.locator}。仅作独立历史 / 业务参考，不是当前报告期财务来源。`)] : null),
    items.length ? el('div', { class: 'company-news-list' }, ...items.map(n => companyNewsArticle(n, true, 3))) : el('p', { class: 'empty-state' }, '暂未收录新闻与公告'));
  replacePreservingDetails(companyHost,
    el('div', { class: 'company-breadcrumb' }, button(standaloneSymbol ? '返回阅读流程' : '返回产业全景', 'close-company', null, { class: 'back-panorama' }), el('span', {}, `${data.industry.name} / ${nameOf(c)}`)),
    el('div', { class: 'company-heading' }, el('div', {}, el('div', { class: 'company-name-line' }, el('h1', { tabindex: '-1' }, nameOf(c)), el('span', { class: 'company-code' }, codeOf(c)), p ? el('span', { class: 'sector-label' }, p.sector) : null),
      c.profile?.purpose ? el('p', { class: 'company-description' }, c.profile.purpose) : null),
      el('div', { class: 'report-stamp' }, el('strong', {}, latest ? `${latest.period_end.slice(0, 4)} ${latest.period_type}` : '暂无报告'), el('span', {}, latest ? `截至 ${latest.period_end}` : '见读取状态'))),
    standaloneSymbol ? el('p', { class: 'quote-status' }, standaloneModel?.profile ? `${standaloneModel.profile.source || '资料来源未提供'} · ${standaloneModel.profile.as_of || '资料时间未提供'}${standaloneModel.profile.status === 'stale' ? ' · 缓存资料，尚未更新' : standaloneModel.profile.status === 'unavailable' ? ' · 资料不可用' : ''}` : '公司资料暂不可用；财务与新闻独立读取。') : el('p', { class: 'quote-status' }, profiles.market.note),
    companyNewsContext(),
    el('nav', { class: 'company-navigation', 'aria-label': '公司详情内容' }, ...COMPANY_TABS.map(([key, text]) => button(text, 'company-tab', key, { id: `company-nav-${key}`, 'aria-controls': `company-${key}`, 'aria-pressed': String(key === detailTab) }))),
    overview, financialPanel, businessPanel, announcements);
  updateCompanyTab();
}
function updateCompanyTab() {
  companyHost.querySelectorAll('[data-company-panel]').forEach(panel => { panel.hidden = panel.dataset.companyPanel !== detailTab; });
  companyHost.querySelectorAll('.company-navigation button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === detailTab)));
  updatePageTitle();
}
function financialTable(c, f) {
  return el('table', { class: 'financial-table' }, el('caption', { class: 'sr-only' }, `${nameOf(c)}最近同币种 FY 年报，实际 ${f.years.length} 年，${moneyUnit(f.currency)}`),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, moneyUnit(f.currency)), ...f.periods.map(p => el('th', { scope: 'col' }, `${p.period_end} FY`)))),
    el('tbody', {}, ...[['revenue', '营业收入'], ['net_profit', '归母净利润'], ['operating_cashflow', '经营现金流']].map(([key, label]) =>
      el('tr', {}, el('th', { scope: 'row' }, label), ...f[key].map(value => el('td', {}, Number.isFinite(value) ? amount(value) : '未提供'))))));
}
function financialSource(f) {
  return el('div', { class: 'source-entry' }, el('p', {}, f.note),
    el('p', {}, `金额由原币元 ÷ 1亿换算为${moneyUnit(f.currency)}，显示两位小数。仅同币种、同一报告期字段；缺失不补零。具体分表来源及获取时间见下方口径说明。`));
}
function renderCurrent() {
  currentHost.dataset.type = selection.type;
  if (selection.type === 'bridge') renderBridgeState();
  else if (selection.type === 'feed') renderFeed();
  else if (selection.type === 'news') renderNews();
  else if (selection.type === 'node') renderNode();
  else renderCompany();
}
function footer() {
  const summary = context.industries[industryId].summary;
  const meta = panoramaMeta.get(industryId);
  return el('footer', { class: 'page-footer' }, el('span', {}, `产业资料 · ${meta?.as_of || '资料时间未提供'}`),
    el('details', {}, el('summary', {}, '资料'), el('p', {}, meta?.source || '来源未提供'), ...(meta?.warnings || []).map(warning => el('p', {}, warning)), el('p', {}, summary.attribution),
      ...summary.sources.map(s => el('div', { class: 'source-entry' }, externalLink(s.title, s.url))),
      ...data.sources.map(s => el('div', { class: 'source-entry' }, externalLink(`${s.publisher} · ${s.title}`, s.url), s.locator ? el('p', {}, s.locator) : null))));
}
app.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;
  pendingEditorialReveal = null;
  if (action === 'retry') { start(); return; }
  if (action === 'retry-company') { startCompany(); return; }
  if (!data) return;
  if (action === 'inspector-tab') { showInspector(id); storeRoute(); return; }
  if (action === 'retry-fundamentals') {
    const c = companies.get(id);
    if (!c || (detailCompany ? detailCompany !== id : selection.type !== 'company' || selection.id !== id)) return;
    fundamentals.load(c.symbol, true);
    if (detailCompany) refreshCompanyFinance(companyHost, renderCompanyWorkspace);
    else refreshCompanyFinance(currentHost, renderCompany);
    return;
  }
  if (action === 'editorial-panorama') {
    const canvas = panoramaHost?.querySelector('.matrix-skeleton');
    const heading = canvas?.querySelector('h2');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    if (canvas) window.scrollTo({ top: Math.max(0, window.scrollY + canvas.getBoundingClientRect().top - 12), behavior: 'auto' });
    storeRoute(); return;
  }
  if (action === 'refresh-editorial') { void loadCurrentEditorial(); return; }
  if (action === 'current-editorial') {
    const item = liveEditorial.items.find(item => item.id === id && item.industry_links?.some(link => link.industry_id === industryId));
    if (item) selectCurrentEditorial(item);
    return;
  }
  if (action === 'news' && id?.startsWith('live:')) {
    const item = liveEditorial.items.find(item => `live:${item.id}` === id);
    if (item) selectCurrentEditorial(item);
    return;
  }
  if (action === 'retry-impact') { void prepareImpact(true); return; }
  if (action === 'retry-structure') { void prepareStructure(true); return; }
  if (action === 'retry-news') {
    if (!editorial.id) return;
    syncEditorialContext(editorial.id, true); focusEditorial(); showInspector('detail'); render(); storeRoute(); return;
  }
  if (action === 'bridge-news') {
    if (!editorial.id) return;
    focusEditorial(); layers.news = true; showInspector('detail');
    if (detailCompany) closeCompany(selection);
    else { updateFocus(); storeRoute(); }
    currentHost.querySelector('h2')?.focus({ preventScroll: true });
    currentHost.scrollIntoView({ block: 'nearest' }); return;
  }
  if (action === 'industry' || action === 'bridge-industry') {
    if (!INDUSTRIES.some(i => i.id === id)) return;
    if (!datasets[id]) {
      const next = new URL(location.href); next.searchParams.set('industry', id); next.searchParams.delete('company'); next.searchParams.delete('node');
      location.assign(`${next.pathname}${next.search}`); return;
    }
    if (industryId === id) {
      if (action === 'bridge-industry') {
        storeRoute(); detailCompany = null; focusEditorial(); layers.news = true; showInspector('detail');
        render(); storeRoute(true); currentHost.querySelector('h2')?.focus({ preventScroll: true });
      } else if (detailCompany) closeCompany();
      return;
    }
    storeRoute(); industryId = id; detailCompany = null; detailTab = 'overview'; panoramaScroll = 0;
    inspectorState = { tab: 'detail', open: null, scrollTop: 0 };
    const route = new URL(location.href); route.searchParams.delete('node'); route.searchParams.delete('selected_company'); history.replaceState(history.state, '', route);
    layers = { status: true, news: true, companies: false }; focusedNewsId = null; selection = { type: 'feed' }; search = ''; view = 'stages';
    trendKeys = { quick: 'net_profit', detail: 'net_profit' };
    if (editorial.id) focusEditorial();
    render(); window.scrollTo(0, 0); storeRoute(true);
    [...app.querySelectorAll('[data-action="industry"]')].find(b => b.dataset.id === id)?.focus({ preventScroll: true }); return;
  }
  if (action === 'expand-company') { openCompany(id, target.dataset.tab); return; }
  if (action === 'close-company') { closeCompany(); return; }
  if (action === 'company-tab') {
    if (!detailCompany || !COMPANY_TABS.some(([key]) => key === id)) return;
    detailTab = id; updateCompanyTab(); storeRoute();
    if (!target.closest('.company-navigation')) {
      companyHost.querySelector('.company-navigation').scrollIntoView({ block: 'start' });
      companyHost.querySelector(`#company-nav-${id}`)?.focus({ preventScroll: true });
    }
    return;
  }
  if (action === 'company-role') {
    if (detailCompany && nodes.has(id)) closeCompany({ type: 'company', id: detailCompany, nodeId: id, gap: false });
    return;
  }
  if (action === 'company-news') {
    if (newsItems().some(n => n.id === id)) { focusedNewsId = id; closeCompany({ type: 'news', id }); }
    return;
  }
  if (action === 'trend') {
    const scope = target.dataset.scope;
    if (!['quick', 'detail'].includes(scope) || !TREND_METRICS.some(([key]) => key === id)) return;
    const slot = target.closest('.trend-module')?.dataset.trendSlot || '';
    trendKeys[scope] = id;
    app.querySelectorAll(`[data-trend-scope="${scope}"]`).forEach(host => host.replaceWith(trendModule(host.dataset.company, scope, host.dataset.trendSlot)));
    [...app.querySelectorAll(`[data-trend-scope="${scope}"]`)].find(host => (host.dataset.trendSlot || '') === slot)?.querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true });
    storeRoute(); return;
  }
  if (action === 'layer') { layers[id] = !layers[id]; updateFocus(false); storeRoute(); return; }
  if (action === 'view') { if (view !== id) { view = id; renderBusiness(); updateFocus(false); storeRoute(); } return; }
  if (action === 'reset') {
    layers = { status: true, news: true, companies: false }; focusedNewsId = null; selection = { type: 'feed' }; search = ''; view = 'stages';
    if (editorial.id) focusEditorial();
    showInspector('detail'); app.querySelector('#company-search').value = ''; renderBusiness(); updateFocus(); storeRoute(); return;
  }
  if (action === 'feed') { selection = { type: 'feed' }; focusedNewsId = null; }
  else if (action === 'node-news') selection = { type: 'feed', filterNodeId: id };
  else if (action === 'news') { selection = { type: 'news', id }; focusedNewsId = id; }
  else if (action === 'company') selectCompany(id, target.dataset.nodeId || null);
  else if (action === 'node') selection = { type: 'node', id };
  else if (action === 'participation') { const p = data.participations[Number(id)]; selectCompany(p.company_id, p.node_id); }
  else if (action === 'gap') { const [companyId, nodeId] = id.split('|'); selectCompany(companyId, nodeId, true); }
  else return;
  const fromLibrary = Boolean(target.closest('.inspector-library'));
  showInspector('detail');
  search = ''; app.querySelector('#company-search').value = ''; updateFocus(); storeRoute();
  if (fromLibrary) {
    currentHost.querySelector('h2')?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 900px)').matches) currentHost.scrollIntoView({ block: 'start' });
  }
});
app.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !data || event.target.closest('core-navigation')) return;
  const details = event.target.closest('details[open]');
  if (details) { details.open = false; details.querySelector('summary')?.focus({ preventScroll: true }); return; }
  if (detailCompany) { closeCompany(); return; }
  if (selection.type === 'company') selection = { ...selection, nodeId: null, gap: false };
  search = ''; app.querySelector('#company-search').value = ''; updateFocus(); storeRoute();
});
// Further user input cancels a pending reveal, so a slow response cannot pull
// someone back after they have continued navigating or scrolling the canvas.
for (const type of ['pointerdown', 'wheel', 'touchstart', 'keydown', 'input', 'popstate']) {
  window.addEventListener(type, () => { pendingEditorialReveal = null; }, { capture: true, passive: true });
}
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => {
  if (standaloneSymbol) {
    const tab = new URLSearchParams(location.search).get('tab');
    detailTab = COMPANY_TABS.some(([key]) => key === tab) ? tab : 'overview';
    if (companyHost) updateCompanyTab();
  } else if (datasets) restoreRoute(history.state?.stockWorkspace);
});
let scrollFrame = false;
window.addEventListener('scroll', () => {
  if (!data || scrollFrame) return;
  scrollFrame = true;
  requestAnimationFrame(() => { scrollFrame = false; if (data) storeRoute(); });
}, { passive: true });
start();
