import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, errorMessage, post, safeUrl } from './api';
import { useAction, useApi } from './hooks';
import { ErrorBox, Loading, MetaLine, Notice, PageHeader, SyncButton } from './components';
import NewsSourcesPage from './NewsSources';
import { EditorialDiagnostics } from './Editorial';
import type { Config, ConfigUpdate, ModelTest } from './types';

export default function SettingsPage() {
  const location = useLocation();
  const config = useApi<Config>('/config');
  const [savedNotice, setSavedNotice] = useState(false);
  const [configEpoch, setConfigEpoch] = useState(0);
  useEffect(() => {
    if (config.data && window.location.hash) requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView());
  }, [config.data]);
  return <div className="full-page settings-page"><PageHeader title="设置" description="数据与 AI 独立选择。密钥只提交给后端，不在浏览器持久保存。"><button type="button" onClick={() => { if (window.confirm('重新读取会放弃当前未保存的输入。是否继续？')) { setSavedNotice(false); setConfigEpoch(value => value + 1); config.reload(); } }} disabled={config.loading}>重新读取配置</button></PageHeader>
    <section id="data" className="data-management"><h2>数据更新</h2><p className="section-note">更新新闻以获得新的阅读内容，更新证券资料以补全公司目录。无需先配置模型；自动预分析由下方设置单独控制。</p><div className="data-update-actions"><SyncButton kind="news">更新新闻</SyncButton><SyncButton kind="securities">更新证券资料</SyncButton></div><nav className="data-management-links" aria-label="数据管理"><Link to="/jobs">更新进度与历史</Link><Link to="/settings#sources" state={location.state}>管理新闻来源</Link><Link to="/chain#packages">安装与导入产业主题</Link><Link to="/securities">查看公司覆盖</Link></nav></section>
    {config.loading && !config.data && <Loading />}<ErrorBox message={config.error} retry={config.reload} />
    <Notice message={savedNotice ? '上次提交的配置已保存；后续更改需再次保存。' : null} />
    {config.data && <ConfigForm key={`${configEpoch}:${JSON.stringify(config.data)}`} initial={config.data} onDone={() => setSavedNotice(true)} />}
    <MetaLine meta={config.meta} />
    <section id="sources" className="sources-section"><NewsSourcesPage embedded /><EditorialDiagnostics /></section>
  </div>;
}
function ConfigForm({ initial, onDone }: { initial: Config; onDone: () => void }) {
  const [form, setForm] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [modelKey, setModelKey] = useState('');
  const [ycoreKey, setYcoreKey] = useState('');
  const [clearModel, setClearModel] = useState(false);
  const [clearYcore, setClearYcore] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);
  const action = useAction();
  const [modelTest, setModelTest] = useState<{ busy: boolean; result: ModelTest | null; error: string | null }>({ busy: false, result: null, error: null });
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline) || Boolean(modelKey || ycoreKey || clearModel || clearYcore);
  useEffect(() => { setModelTest({ busy: false, result: null, error: null }); }, [form, modelKey, ycoreKey, clearModel, clearYcore]);
  async function testModel() {
    if (dirty || action.busy || modelTest.busy) return;
    setModelTest({ busy: true, result: null, error: null });
    try {
      const response = await post<ModelTest>('/config/test-model');
      if (!response.data.ok) throw new Error('模型测试未通过，请核对已保存的模型配置。');
      setModelTest({ busy: false, result: response.data, error: null });
    } catch (error) { setModelTest({ busy: false, result: null, error: scrub(errorMessage(error)) }); }
  }
  function update<K extends keyof Config>(key: K, value: Config[K]) { setForm(current => ({ ...current, [key]: value })); setSaved(false); }
  function scrub(text: string) { for (const secret of [modelKey, ycoreKey]) if (secret) text = text.split(secret).join('[已隐藏]'); return text; }
  function submit(event: FormEvent) {
    event.preventDefault(); setSaved(false);
    void action.run(async () => {
      for (const [name, value] of [['ycore 服务地址', form.ycore_url], ['模型服务地址', form.model_base_url]]) {
        if (value && !safeUrl(value)) throw new Error(`${name}必须是 HTTP(S) URL，且不能在 URL 中包含账号或密钥。`);
      }
      if ((form.data_mode === 'ycore' || form.ai_mode === 'ycore') && !form.ycore_url.trim()) throw new Error('使用 ycore 模式前，请填写 ycore 服务地址。');
      if (!Number.isInteger(form.sync_interval_minutes) || form.sync_interval_minutes < 0) throw new Error('同步间隔必须为非负整数分钟。');
      const payload: ConfigUpdate = {
        data_mode: form.data_mode, ai_mode: form.ai_mode, ycore_url: form.ycore_url.trim(),
        model_base_url: form.model_base_url.trim(), model_name: form.model_name.trim(),
        auto_analyze: form.auto_analyze, sync_interval_minutes: form.sync_interval_minutes,
        ...(clearModel ? { clear_model_key: true } : modelKey ? { model_api_key: modelKey } : {}),
        ...(clearYcore ? { clear_ycore_key: true } : ycoreKey ? { ycore_api_key: ycoreKey } : {}),
      };
      try {
        const response = await api<Config>('/config', { method: 'PUT', body: JSON.stringify(payload) });
        setSaveWarnings(response.meta.warnings.map(scrub));
        setForm(response.data); setBaseline(response.data); setModelKey(''); setYcoreKey(''); setClearModel(false); setClearYcore(false);
        setSaved(true); onDone();
      } catch (error) { throw new Error(scrub(errorMessage(error))); }
    });
  }
  return <form onSubmit={submit} className="config-form">
    <fieldset disabled={action.busy || modelTest.busy}><legend>运行模式</legend><div className="form-columns"><div className="field"><label htmlFor="data-mode">数据模式</label><select id="data-mode" value={form.data_mode} onChange={event => update('data_mode', event.target.value as Config['data_mode'])}><option value="local">本地数据服务</option><option value="ycore">远程 ycore 数据</option></select><p className="field-help">本地服务自行同步公开来源，不依赖 ycore。</p></div>
      <div className="field"><label htmlFor="ai-mode">AI 模式</label><select id="ai-mode" value={form.ai_mode} onChange={event => update('ai_mode', event.target.value as Config['ai_mode'])}><option value="local">自有模型 · 服务端直连</option><option value="ycore">远程 ycore AI</option></select><p className="field-help">与数据模式互不绑定；无模型也可阅读事件与证据。</p></div></div>
      <p className="message">当前选择：{form.data_mode === 'local' ? '本地数据' : 'ycore 数据'} + {form.ai_mode === 'local' ? '自有模型' : 'ycore AI'}。配置保存不代表远程服务已上线，也不代表事件已分析。</p>
    </fieldset>
    <fieldset id="model" disabled={action.busy || modelTest.busy}><legend>自有模型</legend><p className="section-note">使用 OpenAI-compatible 模型服务。填写后<a href="#config-actions">保存并测试模型 ↓</a>，密钥只交给服务端，不会自动请求模型。</p><div className="form-columns"><div className="field"><label htmlFor="model-url">模型 API Base URL</label><input id="model-url" type="url" value={form.model_base_url} onChange={event => update('model_base_url', event.target.value)} placeholder="https://your-provider.example/v1" autoComplete="off" /></div><div className="field"><label htmlFor="model-name">模型名称</label><input id="model-name" value={form.model_name} onChange={event => update('model_name', event.target.value)} autoComplete="off" placeholder="填写供应商的模型标识" /></div></div>
      <div className="field"><label htmlFor="model-key">模型 API 密钥 <span className="muted">（{form.model_key_set ? '服务端已保存' : '未保存'}）</span></label><input id="model-key" type="password" autoComplete="new-password" value={modelKey} onChange={event => { setModelKey(event.target.value); setSaved(false); }} disabled={clearModel} placeholder="留空保留已存密钥" aria-describedby="key-help" /></div>
      <label className="checkbox-label"><input type="checkbox" checked={clearModel} onChange={event => { setClearModel(event.target.checked); if (event.target.checked) setModelKey(''); setSaved(false); }} />保存时明确清除模型密钥</label>
    </fieldset>
    <fieldset disabled={action.busy || modelTest.busy}><legend>远程 ycore</legend><div className="field"><label htmlFor="ycore-url">ycore 服务 URL</label><input id="ycore-url" type="url" value={form.ycore_url} onChange={event => update('ycore_url', event.target.value)} placeholder="填写兼容 API v1 的远程服务地址" autoComplete="off" required={form.ai_mode === 'ycore' || form.data_mode === 'ycore'} /></div>
      <div className="field"><label htmlFor="ycore-key">ycore API 密钥 <span className="muted">（{form.ycore_key_set ? '服务端已保存' : '未保存'}）</span></label><input id="ycore-key" type="password" autoComplete="new-password" value={ycoreKey} onChange={event => { setYcoreKey(event.target.value); setSaved(false); }} disabled={clearYcore} placeholder="留空保留已存密钥" aria-describedby="key-help" /></div>
      <label className="checkbox-label"><input type="checkbox" checked={clearYcore} onChange={event => { setClearYcore(event.target.checked); if (event.target.checked) setYcoreKey(''); setSaved(false); }} />保存时明确清除 ycore 密钥</label>
      <p className="field-help">托管 AI 的 Cloudflare AI Gateway routing 应由远程服务部署声明与执行；浏览器不接收 Gateway 或供应商密钥。本界面不宣称 ycore 已部署。</p>
    </fieldset>
    <fieldset disabled={action.busy || modelTest.busy}><legend>同步与自动分析</legend><div className="field narrow-field"><label htmlFor="sync-interval">自动同步间隔（分钟）</label><input id="sync-interval" type="number" min="0" step="1" required aria-describedby="sync-interval-help" value={Number.isFinite(form.sync_interval_minutes) ? form.sync_interval_minutes : ''} onChange={event => update('sync_interval_minutes', event.target.valueAsNumber)} /><p id="sync-interval-help" className="field-help">设为 0 关闭定时同步；仍可在数据更新页随时手动更新。</p></div><label className="checkbox-label"><input type="checkbox" checked={form.auto_analyze} onChange={event => update('auto_analyze', event.target.checked)} />启用重点事件自动预分析</label><p className="field-help">需模型可用；新增证据会使已有分析变为陈旧。开启开关不意味着分析已完成。</p></fieldset>
    <p id="key-help" className="field-help">密钥仅通过密码框提交并由服务端保存。空白不覆盖；清除需勾选对应选项再保存。页面不提供密钥回显。</p>
    <div id="config-actions" className="form-actions"><button className="primary" type="submit" disabled={action.busy || modelTest.busy}>{action.busy ? '正在保存…' : '保存配置'}</button><button type="button" disabled={action.busy || modelTest.busy || dirty} onClick={() => void testModel()}>{modelTest.busy ? '正在实际调用模型…' : '测试已保存的模型'}</button><button type="button" disabled={action.busy || modelTest.busy || !dirty} onClick={() => { setForm(baseline); setModelKey(''); setYcoreKey(''); setClearModel(false); setClearYcore(false); setSaved(false); }}>撤销未保存更改</button></div>
    <p className="field-help">{dirty ? '有未保存更改：请先保存，再测试模型。输入不会自动覆盖服务端设置。' : '测试会使用已保存的 AI 模式发起一次真实的最小模型调用，可能产生少量费用；不会自动分析事件。'}</p>
    <ErrorBox message={action.error} /><Notice message={saved && !dirty ? '配置已保存。下一步点击“测试已保存的模型”，验证真实调用。' : null} />
    {modelTest.busy && <Loading label="正在连接已保存的模型，等待真实回复…" />}<ErrorBox message={modelTest.error} />{modelTest.error && <p className="field-help">测试失败，尚未确认模型可用。请核对服务地址、模型名称和密钥；修改后重新保存再测试。</p>}
    <Notice message={modelTest.result ? `模型测试通过：${modelTest.result.model} · 耗时 ${modelTest.result.latency_ms} 毫秒。现在可以返回事件请求分析。` : null} />{modelTest.result && <p><Link to="/securities">前往公司，按需研究 →</Link></p>}{saveWarnings.length > 0 && <ul className="warnings">{saveWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
  </form>;
}
