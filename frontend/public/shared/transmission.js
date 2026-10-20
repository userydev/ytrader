// Shared news → variable → parallel graph roles. Array order is never a causal edge.
const graphCache = new Map();
function element(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function append(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function graphValid(graph, id) {
  if (graph?.industry?.id !== id || !['nodes', 'relations', 'companies', 'participations'].every(key => Array.isArray(graph[key]))) return false;
  const nodes = new Set(graph.nodes.map(node => node.id)), companies = new Set(graph.companies.map(company => company.id));
  return nodes.size === graph.nodes.length && companies.size === graph.companies.length &&
    graph.companies.every(company => typeof company.id === 'string' && typeof company.name === 'string') &&
    graph.nodes.every(node => typeof node.id === 'string' && typeof node.name === 'string') &&
    graph.relations.every(edge => nodes.has(edge.from_id) && nodes.has(edge.to_id)) &&
    graph.participations.every(part => nodes.has(part.node_id) && companies.has(part.company_id) && typeof part.role === 'string');
}
function localReturn(value) {
  try { const url = new URL(value, location.origin); if (url.origin === location.origin && !url.username && !url.password && !/[\\\u0000-\u0020]/.test(value) && /^\/(?:events(?:\/[^/]+)?|securities(?:\/[^/]+)?|chain|industry\/(?:index\.html)?)\/?$/.test(url.pathname)) return `${url.pathname}${url.search}`; } catch { /* Keep navigation local. */ }
  return '/events';
}
function pathHref(context, link, nodeId, company) {
  const params = new URLSearchParams({ industry: link.industry_id, name: link.name || link.industry_name || link.industry_id, news: context.eventId, progress: context.progressId, return: localReturn(context.returnTo) });
  if (nodeId) params.set('node', nodeId);
  if (company && /^(SH|SZ|BJ):\d{6}$/.test(company.symbol || '')) return `/securities/${encodeURIComponent(company.symbol)}?${params}`;
  if (company) params.set('company', company.id);
  return `/chain?${params}`;
}
function sourceDetails(context, link, graph, known) {
  const details = append(element('details', '', { class: 'tx-sources' }), element('summary', '来源与业务连接'));
  details.append(element('p', link.relation === 'association' ? '主题相关，不代表已发生影响。' : '条件影响为待核实推断；原图业务连接不是本次新闻因果边，不证明公司财务或股价已受影响。'));
  for (const item of [...new Map((link.evidence || []).map(item => [`${item.article_id}:${item.quote}`, item])).values()]) {
    const report = (context.reports || []).find(report => report.id === item.article_id);
    details.append(element('blockquote', item.quote || item.trigger || ''));
    if (report?.source) details.append(element('p', [report.source, report.published_at].filter(Boolean).join(' · ')));
    if (item.observed_at) details.append(element('p', `观察时间（非发布时间）：${item.observed_at}`));
    const url = item.url || item.page_url || report?.url;
    try { const parsed = new URL(url); if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) details.append(element('a', '来源原文 ↗', { href: parsed.href, target: '_blank', rel: 'noopener noreferrer' })); } catch { /* No guessed source. */ }
  }
  if (graph) {
    const names = new Map(graph.nodes.map(node => [node.id, node.name]));
    const edges = graph.relations.filter(edge => known.has(edge.from_id) && known.has(edge.to_id));
    details.append(element('h4', '原图业务连接 · 非本次影响路径'));
    for (const edge of edges) details.append(element('p', `${names.get(edge.from_id)} → ${names.get(edge.to_id)}：${edge.explanation || edge.kind}`));
    if (!edges.length) details.append(element('p', '所列环节按并列关联展示；原图未收录它们之间的直接业务连接。'));
    const missing = (link.node_ids || []).filter(id => !known.has(id));
    if (missing.length) details.append(element('p', `原图未定位的环节：${missing.join('、')}。`));
    if (!known.size) details.append(element('p', '此关联尚无已确认的环节映射，因此不展示参与公司。'));
    const sourceIds = new Set([...edges.flatMap(edge => edge.sources || []), ...graph.participations.filter(part => known.has(part.node_id)).flatMap(part => part.sources || [])]);
    for (const source of graph.sources || []) if (sourceIds.has(source.id)) {
      try { const url = new URL(source.url); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) details.append(element('a', source.title, { href: url.href, target: '_blank', rel: 'noopener noreferrer' })); } catch { /* Invalid sources remain absent. */ }
    }
  }
  if (link.mechanism_reference) {
    try { const url = new URL(link.mechanism_reference.url); if (url.protocol === 'https:' && !url.username && !url.password) details.append(element('a', `机制参考（非新闻证据）：${link.mechanism_reference.name}`, { href: url.href, target: '_blank', rel: 'noopener noreferrer' })); } catch { /* No unsafe links. */ }
  }
  details.append(element('small', [link.basis || 'rule_inference', link.rule_version, context.eventId, context.progressId, link.news_version, link.source_version, link.impact_version].filter(Boolean).join(' · ')));
  return details;
}
export function registerTransmission(api) {
  if (customElements.get('core-transmission')) return;
  if (!document.querySelector('link[data-transmission-style]')) document.head.append(element('link', '', { rel: 'stylesheet', href: '/shared/transmission.css', 'data-transmission-style': '' }));
  class Transmission extends HTMLElement {
    set context(value) { this.value = value; this.render(); }
    get context() { return this.value; }
    connectedCallback() { this.render(); }
    render() {
      const context = this.value;
      if (!context || !this.isConnected) return;
      this.replaceChildren();
      const links = context.links || [];
      this.className = 'tx-context';
      if (!links.length) { this.append(element('p', '暂未识别出有依据的产业传导。', { class: 'tx-muted' })); return; }
      this.append(element('h3', '本条新闻与产业影响'));
      for (const link of links) {
        const article = element('article', '', { class: 'tx-path' });
        const trigger = (link.evidence || []).find(item => item.quote)?.quote?.split('\n')[0] || context.title;
        article.append(element('h4', link.name || link.industry_name || link.industry_id));
        if (link.relation === 'association') {
          article.append(element('p', '主题相关 · 暂无已定位的影响环节', { class: 'tx-muted' }), element('p', link.mechanism), sourceDetails(context, link, null, new Set()));
          this.append(article); continue;
        }
        article.append(element('small', '条件推断 · 未核实；下列环节并列关联，不构成确定因果路径。', { class: 'tx-muted' }));
        const flow = element('div', '', { class: 'tx-flow' });
        flow.append(append(element('div', '', { class: 'tx-trigger' }), element('p', trigger)),
          append(element('div', '', { class: 'tx-variable' }), element('strong', link.variable), element('p', link.mechanism_summary || link.mechanism)));
        const supplied = context.graphs?.[link.industry_id];
        const cached = graphCache.get(link.industry_id);
        const graph = graphValid(supplied, link.industry_id) ? supplied : cached?.graph;
        const known = new Set((link.node_ids || []).filter(id => graph?.nodes.some(node => node.id === id)));
        if (graph) {
          const branches = element('div', '', { class: 'tx-branches', 'aria-label': '并列关联环节' });
          for (const node of graph.nodes.filter(node => known.has(node.id))) {
            const anchor = element('a', node.name, { href: pathHref(context, link, node.id), class: 'tx-node' });
            if (context.onNode) anchor.onclick = event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); context.onNode(node.id); };
            branches.append(anchor);
          }
          if (known.size) flow.append(branches);
        } else {
          const state = element('p', cached?.error || '正在读取产业资料…', { class: 'tx-muted', role: 'status' });
          flow.append(state);
          if (cached?.error) {
            const retry = element('button', '重试产业资料', { type: 'button' });
            retry.onclick = () => { graphCache.delete(link.industry_id); this.render(); };
            flow.append(retry);
          } else if (!cached) {
            const pending = api(`/panorama/${encodeURIComponent(link.industry_id)}`).then(envelope => {
              if (!graphValid(envelope.data, link.industry_id)) throw new Error('产业身份或引用不符。');
              graphCache.set(link.industry_id, { graph: envelope.data });
            }).catch(error => graphCache.set(link.industry_id, { error: error.message || '产业资料暂不可用。' }));
            graphCache.set(link.industry_id, { pending });
            void pending.then(() => { if (this.isConnected) this.render(); });
          } else if (cached.pending) void cached.pending.then(() => { if (this.isConnected) this.render(); });
        }
        article.append(flow, element('p', `条件：${link.condition_summary || link.condition}`, { class: 'tx-condition' }));
        if (graph) {
          const cards = element('div', '', { class: 'tx-companies', 'aria-label': '原图参与公司' });
          for (const company of graph.companies) {
            const roles = graph.participations.filter(part => part.company_id === company.id && known.has(part.node_id));
            if (!roles.length) continue;
            const card = element('a', '', { href: pathHref(context, link, roles[0].node_id, company), class: 'tx-company' });
            if (context.onCompany) card.onclick = event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); context.onCompany(company.id, roles[0].node_id); };
            card.append(element('strong', company.name));
            if (company.symbol) card.append(element('small', company.symbol));
            for (const role of roles) card.append(element('p', `${graph.nodes.find(node => node.id === role.node_id).name} · ${role.role}`));
            cards.append(card);
          }
          if (cards.childElementCount) article.append(cards);

        }
        // Short summaries must not silently drop a rule's risk conditions.
        const sources = sourceDetails(context, link, graph, known);
        if (link.condition_summary && link.condition_summary !== link.condition) sources.append(element('p', link.condition));
        if (link.mechanism_summary && link.mechanism_summary !== link.mechanism) sources.append(element('p', link.mechanism));
        article.append(sources);
        this.append(article);
      }
    }
  }
  customElements.define('core-transmission', Transmission);
}
