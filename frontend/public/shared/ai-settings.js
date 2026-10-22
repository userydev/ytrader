// One dialog for both shells. Only config reads run automatically; tests are explicit.
const DIRECT = 'openai-compatible';
const OPTIONS = { token_limit_field: 'max_tokens', send_temperature: false, json_mode: true };
const PRESETS = {
  gemini: { label: 'Gemini（官方 API）', base_url: 'https://generativelanguage.googleapis.com', api_format: 'gemini' },
  openai: { label: 'OpenAI', base_url: 'https://api.openai.com/v1', api_format: 'openai', options: { token_limit_field: 'max_completion_tokens' } },
  claude: { label: 'Claude', base_url: 'https://api.anthropic.com', api_format: 'anthropic' },
  deepseek: { label: 'DeepSeek', base_url: 'https://api.deepseek.com', api_format: 'openai' },
  qwen: { label: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api_format: 'openai' },
  kimi: { label: 'Kimi', base_url: 'https://api.moonshot.cn/v1', api_format: 'openai' },
  glm: { label: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', api_format: 'openai' },
  grok: { label: 'Grok', base_url: 'https://api.x.ai/v1', api_format: 'openai' },
  openrouter: { label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', api_format: 'openai' },
};
function presetOf(profile) {
  return Object.keys(PRESETS).find(name => PRESETS[name].api_format === profile.api_format &&
    comparableURL(PRESETS[name].base_url, DIRECT) === comparableURL(profile.base_url, DIRECT)) || 'custom';
}
let sequence = 0;
// Survives navigation re-renders: never overlap a save/test with another dialog's action.
let pendingAction = null;

function element(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function normalizedURL(value, provider) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 须为 HTTP(S) 地址，不能含账号、密码、查询参数或片段。');
  }
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(provider === DIRECT ? /\/chat\/completions$/ : /\/api\/v1$/, '');
  return `${url.origin}${path}`;
}
function comparableURL(value, provider) {
  try { return normalizedURL(value, provider); } catch { return value.trim(); }
}
function checkedConfig(data) {
  const invalid = () => { throw new Error('AI 配置格式不符，请重新读取。'); };
  if (!data || data.contract_version !== '1' || ![DIRECT, 'ycore'].includes(data.provider) || !Number.isInteger(data.revision)) invalid();
  const profiles = {};
  for (const provider of [DIRECT, 'ycore']) {
    const profile = data.profiles?.[provider];
    if (!profile || typeof profile.base_url !== 'string' || typeof profile.model !== 'string' || typeof profile.key_set !== 'boolean') invalid();
    profiles[provider] = { base_url: profile.base_url, model: profile.model, key_set: profile.key_set };
    if (provider === DIRECT) {
      const apiFormat = profile.api_format ?? 'openai';
      if (!['openai', 'gemini', 'anthropic'].includes(apiFormat)) invalid();
      profiles[provider].api_format = apiFormat;
      const options = profile.options;
      if (!options || !['max_tokens', 'max_completion_tokens'].includes(options.token_limit_field) || typeof options.send_temperature !== 'boolean' || typeof options.json_mode !== 'boolean') invalid();
      profiles[provider].options = { token_limit_field: options.token_limit_field, send_temperature: options.send_temperature, json_mode: options.json_mode };
    } else {
      if (typeof profile.legacy_connection !== 'boolean') invalid();
      profiles[provider].legacy_connection = profile.legacy_connection;
    }
  }
  return { provider: data.provider, revision: data.revision, profiles };
}
function draftOf(profile) {
  return { base_url: profile.base_url, model: profile.model, clearKey: false, ...(profile.options ? { api_format: profile.api_format, options: { ...profile.options } } : {}) };
}
function safeError(error) {
  // Never echo arbitrary provider bodies, URLs, submitted values or credentials.
  const messages = {
    400: '配置或请求无效，请检查地址、模型及兼容选项。',
    401: '认证失败，请检查已保存的 Key。',
    403: '访问被拒绝，请检查模型权限或网关策略。',
    404: '服务端点不存在，请检查 Base URL 和网关契约。',
    405: '服务不支持此接口，请检查网关契约。',
    409: '连接未配置完整或配置已变化，请检查已保存的地址、Key 和模型。',
    422: '配置校验失败，请检查地址、模型及兼容选项。',
    429: '请求受限或额度不足，请稍后再试。',
    501: '网关未支持 AI v1 契约；旧版 ycore 尚未接通。',
    502: '上游连接失败或响应不符合契约，请检查服务和模型。',
    503: 'AI 服务暂不可用，请稍后再试。',
    504: '服务连接超时，请稍后再试。',
  };
  if (error.status) return `HTTP ${error.status}：${messages[error.status] || '服务请求失败，请检查配置后重试。'}`;
  if (error.message === '请求超时，请重试。') return error.message;
  if (['AI 配置格式不符，请重新读取。', '连接测试响应格式或提供方不符，未确认连接成功。', '服务端配置已变化，请重新读取后确认。'].includes(error.message)) return error.message;
  if (error.message?.includes('数据格式不符')) return '服务响应格式不符，未确认操作成功。';
  return '连接或服务响应失败，请检查配置并重试。';
}

export function mountAISettings(button, api) {
  const id = `core-ai-${++sequence}`;
  const dialog = element('dialog', '', { class: 'core-ai-dialog', 'aria-labelledby': `${id}-title`, 'aria-describedby': `${id}-intro` });
  button.setAttribute('aria-controls', id);
  dialog.id = id;
  const header = element('div', '', { class: 'core-ai-header' });
  const title = element('h2', 'AI 设置', { id: `${id}-title` });
  const close = element('button', '关闭 ×', { type: 'button', class: 'core-ai-button', 'aria-label': '关闭 AI 设置' });
  header.append(title, close);
  const intro = element('p', '仅管理 AI 连接，不更改数据来源、同步或自动分析设置。打开与保存不会调用模型。', { id: `${id}-intro`, class: 'core-ai-note' });
  const form = element('form');
  const fields = element('fieldset', '', { class: 'core-ai-fields' });
  fields.append(element('legend', '连接配置', { class: 'core-ai-legend' }));
  const addField = (parent, label, input, suffix) => {
    input.id = `${id}-${suffix}`;
    const row = element('div', '', { class: 'core-ai-field' });
    row.append(element('label', label, { for: input.id }), input);
    parent.append(row);
    return row;
  };
  const mode = element('select');
  for (const [value, text] of [['custom', '自定义 API'], ...Object.entries(PRESETS).map(([name, preset]) => [name, preset.label]), ['ycore', 'ycore 统一网关']]) mode.append(element('option', text, { value }));
  addField(fields, 'API 服务 / 独立网关', mode, 'mode');
  const format = element('select');
  for (const [value, text] of [['openai', 'OpenAI 兼容 API'], ['gemini', 'Gemini 原生 API'], ['anthropic', 'Claude / Anthropic 原生 API']]) format.append(element('option', text, { value }));
  const formatRow = addField(fields, 'API 协议', format, 'format');
  const profileStatus = element('p', '', { class: 'core-ai-note' });
  fields.append(profileStatus);
  const base = element('input', '', { type: 'url', required: '', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://api.example.com/v1' });
  addField(fields, '服务 Base URL', base, 'base');
  const baseNote = element('p', '', { class: 'core-ai-note', id: `${id}-base-note` });
  base.setAttribute('aria-describedby', baseNote.id);
  fields.append(baseNote);
  const key = element('input', '', { type: 'password', autocomplete: 'new-password', spellcheck: 'false', placeholder: '留空保留原 Key', 'aria-describedby': `${id}-key-note` });
  addField(fields, 'API Key（不回填）', key, 'key');
  fields.append(element('p', '仅同一地址和协议可留空保留已存 Key；Gemini / Claude 需要自己的 Key。切换服务或协议、保存或关闭会清空新输入的 Key。', { class: 'core-ai-note', id: `${id}-key-note` }));
  const clearKey = element('input', '', { type: 'checkbox' });
  addField(fields, '清除已保存 Key', clearKey, 'clear').classList.add('core-ai-check');
  const endpointHint = element('p', '', { class: 'core-ai-warning' });
  fields.append(endpointHint);
  const model = element('input', '', { type: 'text', required: '', autocomplete: 'off', spellcheck: 'false', placeholder: '填写供应商提供的完整模型 ID（不自动选择型号）' });
  addField(fields, '模型', model, 'model');
  const advanced = element('details', '', { class: 'core-ai-advanced' });
  advanced.append(element('summary', '高级兼容选项（可选）'), element('p', '通常只需填写地址、Key 与模型。若服务拒绝可选参数，可调整 token 字段或关闭 temperature / JSON 模式；这些选项仅用于 OpenAI 兼容协议；Gemini / Claude 由 SDK 映射。', { class: 'core-ai-note' }));
  const token = element('select');
  for (const value of ['max_tokens', 'max_completion_tokens']) token.append(element('option', value, { value }));
  addField(advanced, 'Token 上限字段', token, 'token');
  const temperature = element('input', '', { type: 'checkbox' });
  addField(advanced, '发送 temperature 参数', temperature, 'temperature').classList.add('core-ai-check');
  const json = element('input', '', { type: 'checkbox' });
  addField(advanced, '启用 JSON 模式（response_format）', json, 'json').classList.add('core-ai-check');
  fields.append(advanced);
  const ycoreNote = element('p', '填写 ycore 自己的服务地址与服务令牌；Cloudflare 网关及供应商凭据由 ycore 管理。需支持 AI v1 契约；当前服务仍待适配和联调，保存配置不表示已接通。', { class: 'core-ai-warning' });
  fields.append(ycoreNote);
  const testNote = element('p', '测试仅使用已保存配置及固定的小型探针，可能消耗少量模型额度。修改后须先保存；不会自动测试。', { class: 'core-ai-note', id: `${id}-test-note` });
  const status = element('p', '', { class: 'core-ai-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const actions = element('div', '', { class: 'core-ai-actions' });
  const save = element('button', '保存配置', { type: 'submit', class: 'core-ai-button core-ai-primary' });
  const test = element('button', '测试已保存连接', { type: 'button', class: 'core-ai-button', 'aria-describedby': testNote.id });
  const retry = element('button', '重新读取', { type: 'button', class: 'core-ai-button' });
  actions.append(save, test, retry);
  form.append(fields, testNote, status, actions);
  dialog.append(header, intro, form);
  document.body.append(dialog);

  let disposed = false, generation = 0, busy = false, config = null, drafts = null, currentMode = 'custom';
  const provider = () => currentMode === 'ycore' ? 'ycore' : DIRECT;
  const alive = stamp => !disposed && dialog.open && stamp === generation;
  const say = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('core-ai-error', error);
  };
  const capture = () => {
    if (!drafts) return;
    const draft = drafts[currentMode];
    draft.base_url = base.value;
    draft.model = model.value;
    draft.clearKey = clearKey.checked;
    if (provider() === DIRECT) {
      draft.api_format = format.value;
      draft.options = { token_limit_field: token.value, send_temperature: temperature.checked, json_mode: json.checked };
    }
  };
  const dirty = () => {
    if (!config || !drafts) return true;
    const active = provider(), saved = config.profiles[active];
    return config.provider !== active || comparableURL(base.value, active) !== comparableURL(saved.base_url, active) || model.value.trim() !== saved.model || !!key.value.trim() || clearKey.checked || (active === DIRECT && (format.value !== saved.api_format || (format.value === 'openai' && (token.value !== saved.options.token_limit_field || temperature.checked !== saved.options.send_temperature || json.checked !== saved.options.json_mode))));
  };
  const validFields = () => {
    if (!drafts || !model.value.trim()) return false;
    try { normalizedURL(base.value, provider()); return true; } catch { return false; }
  };
  const update = () => {
    fields.disabled = busy || !config;
    form.setAttribute('aria-busy', String(busy));
    save.disabled = busy || !config || !dirty();
    test.disabled = busy || !config || dirty() || !validFields();
    retry.hidden = busy || !!config;
    save.textContent = busy && pendingAction ? '处理中…' : '保存配置';
    clearKey.disabled = !!key.value.trim();
    key.disabled = clearKey.checked;
    formatRow.hidden = currentMode === 'ycore';
    advanced.hidden = currentMode === 'ycore' || format.value !== 'openai';
    ycoreNote.hidden = currentMode !== 'ycore';
    baseNote.textContent = currentMode === 'ycore' ? '填写服务根地址；末尾 /api/v1 会被移除。' : format.value === 'openai' ? '填写 OpenAI API 前缀（如 /v1）；SDK 追加 /chat/completions，粘贴完整地址也可。' : '填写 SDK 服务根地址，不附加 generateContent 或 messages 路径；由官方 SDK 构造原生请求。';
    if (config) {
      const saved = config.profiles[provider()];
      const direct = config.profiles[DIRECT];
      const savedLabel = config.provider === 'ycore' ? 'ycore' : PRESETS[presetOf(direct)]?.label || '自定义 API';
      profileStatus.textContent = `已保存使用：${savedLabel} · 修订 ${config.revision}；当前配置档：${saved.key_set ? '已保存 Key（不显示）' : '未保存 Key'}。`;
      endpointHint.textContent = saved.key_set && (comparableURL(base.value, provider()) !== comparableURL(saved.base_url, provider()) || (provider() === DIRECT && format.value !== saved.api_format)) ? '地址或协议已改变：保存时旧 Key 将被清除，除非同时输入新的 Key。' : '';
    }
    endpointHint.hidden = !endpointHint.textContent;
  };
  const showDraft = () => {
    const draft = drafts[currentMode];
    mode.value = currentMode;
    base.value = draft.base_url;
    model.value = draft.model;
    key.value = '';
    clearKey.checked = draft.clearKey;
    if (draft.options) {
      format.value = draft.api_format;
      token.value = draft.options.token_limit_field;
      temperature.checked = draft.options.send_temperature;
      json.checked = draft.options.json_mode;
    }
    update();
  };
  const editStatus = () => say(dirty() ? '有未保存修改；请先保存，再测试连接。' : '配置已保存；尚未在此面板测试连接。');
  const initialize = data => {
    config = data;
    const saved = config.profiles[DIRECT], savedMode = presetOf(saved);
    drafts = {
      custom: { base_url: '', model: '', api_format: 'openai', clearKey: false, options: { ...OPTIONS } },
      ycore: draftOf(config.profiles.ycore),
    };
    for (const [name, preset] of Object.entries(PRESETS)) {
      drafts[name] = { base_url: preset.base_url, api_format: preset.api_format, model: '', clearKey: false, options: { ...OPTIONS, ...preset.options } };
    }
    // Never rewrite the initial configuration, including legacy loopback APIs.
    drafts[savedMode] = draftOf(saved);
    currentMode = config.provider === 'ycore' ? 'ycore' : savedMode;
    showDraft();
  };
  const load = async stamp => {
    busy = true;
    say(pendingAction ? '上一项保存或测试仍在完成，请稍候…' : '正在读取已保存配置…');
    update();
    try {
      if (pendingAction) await pendingAction.catch(() => {});
      if (!alive(stamp)) return;
      const response = await api('/ai/config');
      if (!alive(stamp)) return;
      initialize(checkedConfig(response.data));
      editStatus();
    } catch (error) {
      if (alive(stamp)) say(safeError(error), true);
    } finally {
      if (alive(stamp)) { busy = false; update(); }
    }
  };
  const finish = () => {
    ++generation;
    config = null; drafts = null; busy = false;
    key.value = ''; base.value = ''; model.value = ''; clearKey.checked = false;
    profileStatus.textContent = ''; endpointHint.textContent = ''; say('');
    if (dialog.open) dialog.close();
    button.setAttribute('aria-expanded', 'false');
    if (!disposed && button.isConnected) button.focus({ preventScroll: true });
  };
  const open = () => {
    if (disposed || dialog.open) return;
    const stamp = ++generation;
    dialog.showModal();
    button.setAttribute('aria-expanded', 'true');
    close.focus({ preventScroll: true });
    void load(stamp);
  };
  const runAction = async testing => {
    if (busy || pendingAction || !config || (testing && (dirty() || !validFields()))) return;
    capture();
    const stamp = generation, activeProvider = provider();
    let payload;
    if (!testing) {
      const draft = drafts[currentMode];
      let url;
      try { url = normalizedURL(draft.base_url, activeProvider); }
      catch { say('Base URL 须为有效的 HTTP(S) 地址，不能含账号、密码、查询参数或片段。', true); base.focus(); return; }
      if (!draft.model.trim()) { say('请填写模型名称。', true); model.focus(); return; }
      payload = { provider: activeProvider, base_url: url, model: draft.model.trim() };
      if (key.value.trim()) payload.api_key = key.value.trim();
      else if (draft.clearKey) payload.clear_api_key = true;
      if (activeProvider === DIRECT) {
        payload.api_format = draft.api_format;
        if (draft.api_format === 'openai') payload.options = { ...draft.options };
      }
    }
    busy = true;
    say(testing ? '正在测试已保存连接（最多约 190 秒）…' : '正在保存配置（不会调用模型）…');
    // Clear the input even on failed saves; the user must explicitly re-enter a new key.
    if (!testing) key.value = '';
    const task = (async () => {
      if (testing) return (await api('/ai/test', { method: 'POST' }, 190000)).data;
      await api('/ai/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return checkedConfig((await api('/ai/config')).data);
    })();
    if (payload) delete payload.api_key;
    pendingAction = task;
    update();
    try {
      const result = await task;
      if (!alive(stamp)) return;
      if (testing) {
        if (!result || result.ok !== true || result.contract_version !== '1' || result.provider !== activeProvider || typeof result.model !== 'string' || !result.model.trim() || !Number.isFinite(result.latency_ms) || result.latency_ms < 0) throw new Error('连接测试响应格式或提供方不符，未确认连接成功。');
        say(`连接测试成功 · 实际模型：${result.model} · ${result.latency_ms} ms`);
      } else {
        if (result.provider !== activeProvider) throw new Error('服务端配置已变化，请重新读取后确认。');
        initialize(result);
        say('配置已保存；尚未测试连接。');
      }
    } catch (error) {
      if (alive(stamp)) {
        // A failed refresh can follow a successful PUT. Require a fresh read before testing.
        if (!testing) { config = null; drafts = null; clearKey.checked = false; }
        say(`${!testing ? '保存结果未确认，请重新读取配置后检查。' : ''}${safeError(error)}`, true);
      }
    } finally {
      if (pendingAction === task) pendingAction = null;
      if (alive(stamp)) { busy = false; update(); }
    }
  };
  mode.addEventListener('change', () => {
    if (busy || !drafts) return;
    capture();
    currentMode = mode.value;
    const saved = config.profiles[DIRECT];
    if (currentMode === presetOf(saved)) drafts[currentMode] = draftOf(saved);
    showDraft();
    editStatus();
  });
  for (const input of [base, format, model, token, temperature, json, key, clearKey]) {
    input.addEventListener('input', () => {
      if (busy || !drafts) return;
      if (input === base || input === format) {
        key.value = ''; model.value = '';
        // Editing a preset endpoint/protocol becomes a custom draft; retain the
        // original preset so reselecting it restores its saved model and URL.
        if (PRESETS[currentMode]) {
          drafts.custom = { ...drafts[currentMode], options: { ...drafts[currentMode].options } };
          currentMode = 'custom';
          mode.value = currentMode;
        }
      }
      if (input === key && key.value.trim()) clearKey.checked = false;
      if (input === clearKey && clearKey.checked) key.value = '';
      capture(); update(); editStatus();
    });
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (!save.disabled) void runAction(false); });
  test.addEventListener('click', () => void runAction(true));
  retry.addEventListener('click', () => { if (!busy) void load(generation); });
  close.addEventListener('click', finish);
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) finish();
  });
  button.addEventListener('click', open);
  update();
  return () => {
    disposed = true;
    finish();
    button.removeEventListener('click', open);
    button.removeAttribute('aria-controls');
    dialog.remove();
  };
}
