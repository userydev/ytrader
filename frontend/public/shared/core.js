// One navigation and research implementation for both document and React surfaces.
import { registerTransmission } from './transmission.js';
import { mountAISettings } from './ai-settings.js';
export function safeReturn(value, fallback = '/events') {
  try {
    if (typeof value !== 'string' || /[\\\u0000-\u0020]/.test(value)) return fallback;
    const url = new URL(value, location.origin);
    if (url.origin === location.origin && !url.username && !url.password && /^\/(?:events(?:\/[^/]+)?|securities(?:\/[^/]+)?|chain|industry\/(?:index\.html)?)\/?$/.test(url.pathname)) return `${url.pathname}${url.search}${url.hash}`;
  } catch { /* Only known same-origin product routes are valid. */ }
  return fallback;
}
export async function coreApi(path, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/v1${path}`, { ...options, signal: controller.signal, credentials: 'same-origin', mode: 'same-origin', redirect: 'error', headers: { Accept: 'application/json', ...options.headers } });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const error = new Error(typeof body?.detail === 'string' ? body.detail : `读取失败（HTTP ${response.status}）`);
      error.status = response.status;
      throw error;
    }
    const envelope = await response.json();
    if (!envelope || !('data' in envelope) || envelope.meta?.version !== '1') throw new Error('数据格式不符，未回退本地资料。');
    return envelope;
  } catch (error) {
    const failure = new Error(error.name === 'AbortError' ? '请求超时，请重试。' : error.message || '服务暂不可用。');
    if (error.status) failure.status = error.status;
    throw failure;
  }
  finally { clearTimeout(timeout); }
}
function node(tag, text, attrs = {}) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}
class CoreNavigation extends HTMLElement {
  static observedAttributes = ['active'];
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  disconnectedCallback() { this.disposeAI?.(); this.close?.(); }
  render() {
    this.disposeAI?.(); this.close?.(); this.replaceChildren();
    const bar = node('div', '', { class: 'core-bar' });
    const toggle = node('button', '☰', { type: 'button', class: 'core-menu-toggle', 'aria-label': '打开主导航', 'aria-expanded': 'false' });
    const brand = node('a', '产业观察', { href: '/events', class: 'core-brand' });
    const section = node('span', ({ news: '新闻', chain: '产业链', securities: '个股' })[this.getAttribute('active')] || '新闻', { class: 'core-current' });
    const ai = node('button', 'AI 设置', { type: 'button', class: 'core-ai-trigger', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    bar.append(toggle, brand, section, ai);
    const dialog = node('dialog', '', { class: 'core-drawer', 'aria-label': '主导航' });
    const close = node('button', '关闭 ×', { type: 'button', class: 'core-drawer-close' });
    const nav = node('nav', '', { 'aria-label': '主导航' });
    for (const [key, label, href] of [['news', '新闻', '/events'], ['chain', '产业链', '/chain'], ['securities', '个股', '/securities']]) {
      const current = `${location.pathname}${location.search}`;
      const destination = key === 'chain' && this.getAttribute('active') !== 'chain' ? `${href}?${new URLSearchParams({ return: safeReturn(current) })}` : href;
      const link = node('a', label, { href: destination });
      if (this.getAttribute('active') === key) link.setAttribute('aria-current', 'page');
      nav.append(link);
    }
    dialog.append(close, nav); this.append(bar, dialog);
    this.disposeAI = mountAISettings(ai, coreApi);
    const finish = () => { if (dialog.open) dialog.close(); toggle.setAttribute('aria-expanded', 'false'); };
    this.close = finish;
    toggle.onclick = () => { dialog.showModal(); toggle.setAttribute('aria-expanded', 'true'); close.focus(); };
    close.onclick = finish;
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) finish(); } });
    dialog.addEventListener('close', () => { toggle.setAttribute('aria-expanded', 'false'); if (toggle.isConnected) toggle.focus({ preventScroll: true }); });
  }
}
class CoreResearch extends HTMLElement {
  connectedCallback() {
    this.disposed = false; this.generation = (this.generation || 0) + 1;
    const generation = this.generation;
    this.replaceChildren();
    const details = node('details', '', { class: 'core-research' });
    details.append(node('summary', '可选：AI 研究'));
    details.append(node('p', '仅主动调用；研究覆盖此事件或公司资料，不只当前稿件。实际模型与生成时间以服务记录为准。', { class: 'core-note' }));
    const action = node('button', '开始研究', { type: 'button', class: 'core-action' });
    const status = node('p', '', { role: 'status', 'aria-live': 'polite', class: 'core-note' });
    const output = node('div', '', { class: 'core-analysis' });
    details.append(action, status, output); this.append(details);
    const subject = this.getAttribute('subject'), identity = this.getAttribute('identity') || '';
    const base = subject === 'company' ? `/securities/${encodeURIComponent(identity)}` : `/events/${encodeURIComponent(identity)}`;
    const alive = () => !this.disposed && generation === this.generation;
    const renderAnalysis = analysis => {
      output.replaceChildren();
      if (!analysis) { output.append(node('p', '尚无研究结果。')); return; }
      if ((subject === 'company' && analysis.symbol !== identity) || (subject !== 'company' && analysis.event_id !== identity)) throw new Error('研究身份不符，已拒收。');
      const provenance = node('details'); provenance.append(node('summary', '模型与生成信息'), node('p', `${analysis.model || '模型未提供'} · ${analysis.created_at || '生成时间未提供'}${analysis.status === 'stale' ? ' · 旧证据研究' : analysis.status === 'pending_review' ? ' · 产业关联待核查，整项未完成' : ''}`)); output.append(provenance);
      for (const warning of analysis.warnings || []) output.append(node('p', warning));
      for (const [key, label] of [['facts', '事实'], ['links', '产业联系'], ['companies', '相关公司'], ['conditions', '成立条件'], ['counter_evidence', '反证'], ['unknowns', '未知项']]) {
        const section = node('section'); section.append(node('h3', label));
        const claims = analysis.sections?.[key] || [];
        if (!claims.length) section.append(node('p', '本次未提供。'));
        for (const claim of claims) { section.append(node('p', claim.text)); if (claim.evidence_ids?.length) { const evidence = node('details'); evidence.append(node('summary', '证据标识'), node('p', claim.evidence_ids.join('、'))); section.append(evidence); } }
        output.append(section);
      }
    };
    const load = async () => {
      const envelope = await coreApi(subject === 'company' ? `${base}/analysis` : base);
      if (!alive()) return null;
      renderAnalysis(envelope.data.analysis); return envelope.data.job;
    };
    const poll = async job => {
      const deadline = Date.now() + 10 * 60 * 1000;
      while (alive()) {
        if (!job || typeof job.id !== 'string') throw new Error('研究任务信息不完整。');
        status.textContent = job.message || ({ queued: '等待研究…', running: '正在研究…', failed: '研究失败，未生成结果。', succeeded: '研究任务已结束。' })[job.status];
        if (job.status === 'failed') throw new Error(job.message || '研究失败，请重试。');
        if (job.status === 'succeeded') { await load(); return; }
        if (Date.now() > deadline) throw new Error('等待研究超时，任务可能仍在后台运行；可重新展开读取。');
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (!alive()) return;
        const response = await coreApi('/jobs');
        if (!alive()) return;
        const updated = Array.isArray(response.data) && response.data.find(item => item.id === job.id);
        if (!updated) throw new Error('暂未找到此研究任务，请重新展开读取。');
        job = updated;
      }
    };
    let busy = false;
    const run = async submit => {
      if (busy) return;
      busy = true; action.disabled = true; status.textContent = submit ? '正在提交…' : '正在读取研究…';
      try {
        const job = submit ? (await coreApi(`${base}/analyze`, { method: 'POST' })).data : await load();
        if (!alive()) return;
        if (job && (submit || ['queued', 'running', 'failed'].includes(job.status))) await poll(job);
        else status.textContent = '';
      } catch (error) { if (alive()) status.textContent = error.message; }
      finally { busy = false; if (alive()) { action.disabled = false; action.textContent = '重新请求研究'; } }
    };
    details.addEventListener('toggle', () => { if (details.open && !busy) void run(false); });
    action.onclick = () => void run(true);
  }
  disconnectedCallback() { this.disposed = true; }
}
registerTransmission(coreApi);
if (!customElements.get('core-navigation')) customElements.define('core-navigation', CoreNavigation);
if (!customElements.get('core-research')) customElements.define('core-research', CoreResearch);
