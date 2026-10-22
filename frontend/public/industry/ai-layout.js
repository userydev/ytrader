import cytoscape from './vendor/cytoscape.esm.min.mjs';

// Presentation only: coordinates, aliases and reading groups are not facts.
// Every directed edge below is supplied by the host's original relation record.
const GROUPS = [
  { id: 'components', title: '计算芯片与内存', ids: ['gpu_tensor_core', 'hbm_memory', 'cpu_host_processor'] },
  { id: 'alternatives', title: '其他芯片与计算场景', ids: ['cloud_ai_chip_board', 'server_compute_application'] },
  { id: 'manufacturing', title: '晶圆 / 封装接口', ids: ['cowos_package', 'advanced_packaging_activity', 'semiconductor_fabrication_service', 'hpc_product_development_activity'] },
  { id: 'systems', title: '整机与集群', ids: ['dgx_b200_server', 'dgx_superpod_cluster', 'generic_ai_server', 'ieit_ai_server', 'cambricon_compute_cluster', 'cambricon_cluster_integration_activity'] },
  { id: 'internal', title: '系统内互连 / 内存接口', ids: ['nvlink_nvswitch', 'memory_interface_interconnect_chip', 'server_memory_io_activity'] },
  { id: 'network', title: '集群网络 / 光模块', ids: ['infiniband_compute_fabric', 'optical_transceiver_module', 'datacenter_networking_activity'] },
  { id: 'storage', title: '共享存储 / 本地缓存', ids: ['high_performance_storage', 'local_nvme_cache', 'sugon_distributed_storage', 'mass_unstructured_storage_application'] },
  { id: 'workloads', title: '运行与应用', ids: ['ai_model_training_activity', 'ai_workload_orchestration_app', 'compute_service', 'gpu_accelerated_computing_activity'] },
  { id: 'software', title: '软件 / 开发 / 运维', ids: ['cluster_management_software', 'cuda_platform', 'ai_basic_software_platform', 'cluster_operation_activity', 'chip_software_development_activity', 'system_integration_service'] },
  { id: 'power', title: '供配电与机架', ids: ['power_supply_product', 'rack_power_cooling_infra', 'datacenter_cooling_power_activity'] },
  { id: 'cooling', title: '散热 / 液冷', ids: ['liquid_cooling_system', 'precision_cooling_product'] },
  { id: 'idc', title: 'IDC / 数据中心运营', ids: ['idc_service', 'data_center_operation_service', 'hosted_it_operation_activity'] }
];
export function aiReadingGroups(graph) {
  const available = new Set(graph.nodes.map(node => node.id)), seen = new Set();
  const groups = GROUPS.map(group => ({ ...group, ids: group.ids.map(id => `node_${id}`).filter(id => {
    if (!available.has(id) || seen.has(id)) return false;
    seen.add(id); return true;
  }) })).filter(group => group.ids.length);
  const rest = graph.nodes.map(node => node.id).filter(id => !seen.has(id));
  if (rest.length) groups.push({ id: 'other', title: '其他已收录节点', ids: rest });
  return groups;
}

const KINDS = { product: '产品', activity: '活动', service: '服务', application: '应用' };
const RELATIONS = {
  part_of: { label: '组成 → 整体', color: '#49698b', line: 'solid' },
  used_for: { label: '用于', color: '#408477', line: 'solid' },
  supports: { label: '支撑', color: '#aa793b', line: 'dashed' },
  input_to: { label: '投入', color: '#8a739f', line: 'dotted' },
  produces: { label: '产出', color: '#77578f', line: 'solid' },
  precedes: { label: '流程先于', color: '#526b87', line: 'dashed' },
  recycles: { label: '回收', color: '#637044', line: 'dotted' }
};
// Stable semantic preset: B200 has separate arrows to SuperPOD and training.
// In particular there is NO synthetic SuperPOD -> training edge, CPU -> B200
// edge, or NVIDIA -> Cambricon configuration. Shared collection nodes retain
// the distinct applicability of each original edge in the detail view.
const PRESET = {
  gpu_tensor_core: [105, 160, "Tensor Core GPU"],
  hbm_memory: [105, 260, 'HBM 高带宽内存'],
  nvlink_nvswitch: [105, 360, "NVLink\nNVSwitch"],
  local_nvme_cache: [105, 460, '本地 NVMe / 主存'],
  dgx_b200_server: [365, 300, 'DGX B200 服务器'],
  dgx_superpod_cluster: [660, 180, 'DGX SuperPOD 集群'],
  infiniband_compute_fabric: [390, 70, '集群计算网络'],
  high_performance_storage: [680, 70, '高性能共享存储'],
  ai_model_training_activity: [960, 310, 'AI 模型训练 / 推理'],
  ieit_ai_server: [1150, 170, "浪潮信息\nAI 服务器"],
  cluster_management_software: [600, 440, '集群管理软件'],
  cluster_operation_activity: [840, 440, '集群运维 / 部署'],
  compute_service: [1150, 440, "AIDC\n智能算力服务"],
  power_supply_product: [365, 520, 'UPS / 电源设备'],
  rack_power_cooling_infra: [365, 600, '机架 / 配电 / 冷却'],
  precision_cooling_product: [105, 680, '机房精密温控'],
  liquid_cooling_system: [365, 700, '数据中心液冷系统'],
  datacenter_cooling_power_activity: [660, 620, '供电 / 散热保障'],
  cloud_ai_chip_board: [1150, 620, "云端智能芯片\n及板卡"],
  generic_ai_server: [1150, 800, 'AI / 云计算整机'],
  cambricon_cluster_integration_activity: [900, 800, '寒武纪集群集成'],
  cambricon_compute_cluster: [650, 800, '寒武纪计算集群'],
  ai_workload_orchestration_app: [390, 800, 'AI 应用开发 / 部署'],
  cpu_host_processor: [650, -80, '服务器 CPU'],
  server_compute_application: [900, -80, '服务器 / 工作站计算'],
  advanced_packaging_activity: [365, -80, '先进封装 / 异构集成'],
  cowos_package: [105, -80, 'CoWoS 集成组件'],
  optical_transceiver_module: [1410, 100, '高端光通信模块'],
  datacenter_networking_activity: [1670, 100, '数据中心网络互连'],
  system_integration_service: [1150, 70, 'IT 系统集成服务'],
  data_center_operation_service: [900, 70, '数据中心建设 / 运营'],
  cuda_platform: [1150, -80, "CUDA 加速平台"],
  gpu_accelerated_computing_activity: [1410, -80, 'GPU 加速计算'],
  memory_interface_interconnect_chip: [1410, 250, '内存接口 / 互连芯片'],
  server_memory_io_activity: [1670, 250, '服务器内存访问'],
  sugon_distributed_storage: [1410, 850, '曙光 ParaStor 存储'],
  mass_unstructured_storage_application: [1670, 850, '非结构化数据存储'],
  ai_basic_software_platform: [1410, 550, '智能芯片基础软件'],
  chip_software_development_activity: [1670, 550, '芯片软件开发 / 运行'],
  idc_service: [1410, 400, 'IDC 机柜托管'],
  hosted_it_operation_activity: [1670, 400, '机房 IT 托管运行'],
  semiconductor_fabrication_service: [1410, 700, '先进晶圆工艺平台'],
  hpc_product_development_activity: [1670, 700, "HPC 方案开发\n与集成"]
};
const OVERVIEW = new Set([
  'gpu_tensor_core', 'hbm_memory', 'nvlink_nvswitch', 'local_nvme_cache',
  'dgx_b200_server', 'dgx_superpod_cluster', 'infiniband_compute_fabric',
  'high_performance_storage', 'ai_model_training_activity', 'ieit_ai_server',
  'cluster_operation_activity', 'compute_service',
  'power_supply_product', 'rack_power_cooling_infra', 'precision_cooling_product',
  'liquid_cooling_system', 'datacenter_cooling_power_activity', 'cloud_ai_chip_board',
  'generic_ai_server', 'cambricon_cluster_integration_activity', 'cambricon_compute_cluster',
  'ai_workload_orchestration_app'
].map(id => `node_${id}`));
const REFERENCE = new Set(['gpu_tensor_core', 'hbm_memory', 'nvlink_nvswitch', 'local_nvme_cache', 'dgx_b200_server', 'dgx_superpod_cluster', 'infiniband_compute_fabric', 'high_performance_storage'].map(id => `node_${id}`));
const SUPPORT = new Set(['power_supply_product', 'rack_power_cooling_infra', 'precision_cooling_product', 'liquid_cooling_system', 'datacenter_cooling_power_activity', 'cluster_management_software', 'cluster_operation_activity', 'compute_service', 'idc_service', 'hosted_it_operation_activity', 'data_center_operation_service', 'system_integration_service'].map(id => `node_${id}`));

// Exported for the shared adapter; known AI positions and overview stay intact.
export function reviewedAiPresentation(graph) {
  const positions = new Map(), labels = new Map();
  graph.nodes.forEach((node, index) => {
    const key = node.id.replace(/^node_/, '');
    const preset = Object.prototype.hasOwnProperty.call(PRESET, key) ? PRESET[key] : null;
    positions.set(node.id, { x: preset?.[0] ?? 100 + index % 6 * 260, y: preset?.[1] ?? 1450 + Math.floor(index / 6) * 140 });
    if (preset?.[2]) labels.set(node.id, preset[2]);
  });
  return { positions, labels, overview: OVERVIEW, reference: REFERENCE, support: SUPPORT,
    note: '主干：DGX 参考配置；其他厂商与配套按原关系独立呈现。位置不表示供货或兼容。',
    referenceLabel: '蓝框 · DGX 参考配置', branchLabel: '绿框 · 其他范围 / 独立支路', supportLabel: '暖框 · 运行配套',
    edgeClass: r => r.from_id === 'node_cloud_ai_chip_board' && r.to_id === 'node_ai_model_training_activity' ? 'outer-training' :
      r.from_id === 'node_high_performance_storage' && r.to_id === 'node_ai_model_training_activity' ? 'storage-training' :
      r.from_id === 'node_hbm_memory' && r.to_id === 'node_cowos_package' ? 'packaging-link' : '' };
}

function graphStyle(relations, presentation) {
  const style = [
    { selector: 'node', style: {
      width: 180, height: 58, shape: 'round-rectangle', 'background-color': '#fffefa',
      'border-color': '#7e9490', 'border-width': 1.5, label: 'data(label)', color: '#243549',
      'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      'font-size': 20, 'font-weight': 500, 'text-wrap': 'wrap', 'text-overflow-wrap': 'anywhere', 'text-max-width': 164,
      'text-valign': 'center', 'text-halign': 'center', 'line-height': 1.25,
      'overlay-opacity': 0, 'min-zoomed-font-size': 0
    } },
    { selector: 'node.reference', style: { 'border-color': '#49698b', 'background-color': '#f1f5fa' } },
    { selector: 'node.support', style: { 'border-color': '#b49a77', 'background-color': '#fcf8f0' } },
    { selector: 'node[kind = "activity"]', style: { shape: 'ellipse' } },
    { selector: 'node[kind = "application"]', style: { shape: 'round-hexagon' } },
    { selector: 'node[kind = "service"]', style: { 'border-style': 'dashed' } },
    { selector: 'edge', style: {
      width: 1.65, 'curve-style': 'bezier', 'line-color': '#8293a2', 'target-arrow-color': '#8293a2',
      'target-arrow-shape': 'triangle', 'arrow-scale': 0.85, 'opacity': 0.82,
      'line-style': 'solid', 'control-point-step-size': 55, 'overlay-opacity': 0,
      'text-rotation': 'autorotate', 'font-size': 12, color: '#334e66', label: '',
      'text-background-color': '#fffefa', 'text-background-opacity': 0.95,
      'text-background-padding': '3px', 'text-border-opacity': 0,
      'text-margin-y': -9, 'line-dash-pattern': [7, 5]
    } },
    // These long original edges skirt the middle of the reference architecture.
    { selector: 'edge.outer-training', style: { 'curve-style': 'unbundled-bezier', 'control-point-distances': 205, 'control-point-weights': 0.5 } },
    { selector: 'edge.storage-training', style: { 'curve-style': 'unbundled-bezier', 'control-point-distances': -65, 'control-point-weights': 0.5 } },
    { selector: 'edge.packaging-link', style: { 'curve-style': 'unbundled-bezier', 'control-point-distances': -180, 'control-point-weights': 0.5, 'source-endpoint': '-50% 0%', 'target-endpoint': '-50% 0%' } }
  ];
  if (presentation.nodeStyle) style.push({ selector: 'node', style: presentation.nodeStyle });
  Object.entries(relations).forEach(([kind, relation]) => style.push({ selector: `edge[kind = ${JSON.stringify(kind)}]`, style: {
    'line-color': relation.color, 'target-arrow-color': relation.color, 'line-style': relation.line
  } }));
  style.push(
    { selector: '.is-dim', style: { opacity: 0.3 } },
    { selector: 'node.is-neighbor', style: { 'border-width': 2.3 } },
    { selector: 'node.is-focus', style: { 'border-color': '#234c7b', 'border-width': 3.5, 'background-color': '#dfeaf7', 'font-weight': 700, 'z-index': 20 } },
    { selector: 'edge.is-traced', style: { width: 2.7, opacity: 1, 'z-index': 15 } },
    { selector: 'edge.is-edge-focus', style: { width: 3.8, label: 'data(relationLabel)', 'z-index': 30 } },
    { selector: 'node.is-revealed', style: { 'underlay-color': '#8ba9c7', 'underlay-opacity': 0.16, 'underlay-padding': 7 } },
    { selector: '.is-hidden', style: { display: 'none' } }
  );
  return style;
}

// One engine for all maintained chains. The adapter supplies presentation only;
// old exports, action names and CSS hooks remain compatible with saved AI state.
export function createAiLayout({ graph, el, button, moduleHeading, relationNames = {}, expanded, renderEvidence, onViewChange,
  presentation = reviewedAiPresentation(graph), companyLabel = aiCompanyLabel }) {
  const { positions, labels, overview: overviewNodes, reference, support } = presentation;
  const relations = Object.fromEntries([...new Set(graph.relations.map(r => r.kind))].map(kind => [kind,
    Object.prototype.hasOwnProperty.call(RELATIONS, kind) ? RELATIONS[kind] : { label: relationNames[kind] || kind, color: '#8293a2', line: 'solid' }
  ]));
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const companies = new Map(graph.companies.map(company => [company.id, company]));
  const direct = id => graph.relations.filter(r => r.from_id === id || r.to_id === id);
  const endsOf = id => new Set(nodes.has(id) ? [id, ...direct(id).flatMap(r => [r.from_id, r.to_id])] : []);
  const short = id => labels.get(id) || nodes.get(id)?.name || id;
  const relationLabel = r => relations[r.kind]?.label || r.kind;
  const edgeRecords = new Map(graph.relations.map((r, index) => [`ai-relation-${index}`, r]));
  const nodeButtons = new Map(), indexRows = new Map();
  let cy = null, destroyed = false, focus = null, selectedEdge = null, hover = null;
  let visible = new Set(), lastSize = '', motionTimer = null, motionOffset = 0, revealTimer = null;
  let initialFit = true, detailKey = '', auxiliaryKey = '', fitPending = false;
  let explored = new Set(), canvasChoosing = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const counter = el('span', { class: 'ai-node-count', role: 'status', 'aria-live': 'polite' });
  const zoomReading = el('span', { class: 'ai-zoom-reading', 'aria-label': '缩放比例' }, '100%');
  const command = (label, name, attrs = {}) => el('button', { type: 'button', 'data-ai-command': name, ...attrs }, label);
  const expandButton = command('展开相邻环节', 'neighbors', { disabled: true });
  const modeMain = command('主干', 'main', { 'aria-pressed': 'true', title: '展示骨架、独立支路与配套入口；不删改原图' });
  const modeAll = command(`全部 ${nodes.size}`, 'all', { 'aria-pressed': 'false' });
  const focusButton = command('展开大图', 'large', { 'aria-pressed': 'false' });
  const help = el('p', { id: 'ai-graph-help', class: 'ai-graph-help' }, '滚轮缩放 · 空白拖动平移 · 节点可拖动 · 悬停预览 / 点击锁定 · 选中线查看原文。键盘：方向键平移，+ / − 缩放，0 适合全图。');
  const preview = el('p', { class: 'ai-hover-preview', role: 'status' }, presentation.note);
  const board = el('div', { class: 'ai-cy-board', tabindex: '0', role: 'group', 'aria-label': `${graph.industry.name}有向关系画布；可用下方节点索引操作`, 'aria-describedby': 'ai-graph-help' });
  const auxiliary = el('section', { class: 'ai-selection-bar', hidden: true, 'aria-label': '所选节点与公司入口', 'aria-live': 'polite' });
  const edgeDetail = el('section', { class: 'ai-edge-detail', hidden: true, 'aria-label': '原关系详情', tabindex: '-1' });
  const indexSearch = el('input', { type: 'search', placeholder: '搜索节点名称 / 别名', 'aria-label': '搜索全部已收录节点，包括当前隐藏节点' });
  const indexCount = el('span', { class: 'ai-index-count', role: 'status', 'aria-live': 'polite' }, `${nodes.size} 个节点`);
  const anchor = el('select', { 'aria-label': '选择探索锚点，可直接显露隐藏节点及相邻环节' }, el('option', { value: '' }, '选择探索锚点…'),
    ...graph.nodes.map(node => el('option', { value: node.id }, short(node.id))));
  const index = el('details', { class: 'ai-node-index' }, el('summary', {}, `节点索引 / 搜索 · 全部 ${nodes.size}`),
    el('div', { class: 'ai-index-search' }, indexSearch, indexCount),
    el('ul', {}, ...graph.nodes.map(node => {
      const nodeButton = button(node.name, 'node', node.id, { title: node.name, 'aria-pressed': 'false' });
      nodeButtons.set(node.id, nodeButton);
      const group = presentation.groupTitles?.get(node.id);
      const row = el('li', {}, nodeButton, group ? el('small', {}, group) : null,
        el('small', {}, `${KINDS[node.kind] || node.kind} · ${direct(node.id).length} 条直接关系`));
      indexRows.set(node.id, row); return row;
    })));
  const allRelations = el('details', { class: 'ai-all-relations' }, el('summary', {}, `原关系索引 · ${graph.relations.length} 条`),
    el('ul', {}, ...[...edgeRecords].map(([id, r]) => el('li', {}, command(`${nodes.get(r.from_id).name} — ${relationLabel(r)} → ${nodes.get(r.to_id).name}`, 'edge', { 'data-edge-id': id })))));
  const root = el('section', { class: 'industry-module matrix-skeleton ai-layout', 'data-chain': graph.industry.id, 'aria-label': `${graph.industry.name}节点连线探索画布` },
    moduleHeading(`${graph.industry.name} · 结构探索`, counter, 2),
    el('div', { class: 'ai-graph-toolbar', role: 'group', 'aria-label': '图画布工具' },
      el('div', { class: 'ai-mode-tools' }, modeMain, modeAll, button('回总览', 'ai-overview')),
      el('div', { class: 'ai-explore-tools' }, anchor, expandButton),
      el('div', { class: 'ai-viewport-tools' }, command('−', 'out', { 'aria-label': '缩小' }), zoomReading, command('+', 'in', { 'aria-label': '放大' }), command('适合全图', 'fit'), focusButton)),
    el('div', { class: 'ai-graph-stage' }, board,
      el('div', { class: 'ai-structure-key', 'aria-label': '节点边框阅读提示' },
        el('span', { class: 'ai-structure-reference' }, presentation.referenceLabel),
        el('span', { class: 'ai-structure-branch' }, presentation.branchLabel),
        el('span', { class: 'ai-structure-support' }, presentation.supportLabel)), edgeDetail),
    el('div', { class: 'ai-legend', 'aria-label': '关系颜色与线型图例，箭头均保留原方向' },
      ...Object.entries(relations).map(([kind, r]) => el('span', { class: `ai-legend-item ai-kind-${kind}`, style: `color:${r.color}` },
        el('i', { 'aria-hidden': 'true', style: `border-color:${r.color};border-top-style:${r.line}` }),
        `${r.label}${r.line === 'dashed' ? '（虚线）' : r.line === 'dotted' ? '（点线）' : ''}`)),
      Object.keys(relations).some(kind => !Object.prototype.hasOwnProperty.call(RELATIONS, kind)) ? el('span', {}, '未定义类型沿用原类型名与灰色实线，详见原关系。') : null,
      el('span', { class: 'ai-kind-guide' }, '节点：产品矩形 / 活动椭圆 / 应用六边形 / 服务虚边')),
    preview, auxiliary, help,
    el('div', { class: 'ai-accessible-indexes' }, index, allRelations));

  function desiredVisibility() {
    const next = new Set(expanded.has('__all') ? nodes.keys() : [...overviewNodes, ...expanded].filter(id => nodes.has(id)));
    endsOf(focus).forEach(id => next.add(id));
    if (selectedEdge) {
      const r = edgeRecords.get(selectedEdge);
      if (r) { next.add(r.from_id); next.add(r.to_id); }
    }
    return next;
  }
  function refreshVisibility(reveal = false) {
    const next = desiredVisibility(), added = [...next].filter(id => !visible.has(id));
    visible = next;
    if (cy) cy.batch(() => {
      cy.nodes().forEach(node => node.toggleClass('is-hidden', !visible.has(node.id())));
      cy.edges().forEach(edge => {
        const r = edgeRecords.get(edge.id());
        edge.toggleClass('is-hidden', !visible.has(r.from_id) || !visible.has(r.to_id));
      });
      if (reveal && !reducedMotion.matches) {
        clearTimeout(revealTimer);
        cy.nodes().removeClass('is-revealed');
        added.forEach(id => cy.getElementById(id).addClass('is-revealed'));
        revealTimer = setTimeout(() => { if (!destroyed) cy?.nodes().removeClass('is-revealed'); }, 450);
      }
    });
    const edgeCount = graph.relations.filter(r => visible.has(r.from_id) && visible.has(r.to_id)).length;
    counter.textContent = `${visible.size} / ${nodes.size} 节点 · ${edgeCount} / ${graph.relations.length} 条原关系`;
    modeMain.setAttribute('aria-pressed', String(!expanded.has('__all')));
    modeAll.setAttribute('aria-pressed', String(expanded.has('__all')));
    indexRows.forEach((row, id) => row.classList.toggle('is-on-canvas', visible.has(id)));
    const canExpand = nodes.has(focus) && expansionRing(focus).hidden.length > 0;
    expandButton.disabled = !canExpand;
    expandButton.title = canExpand ? '沿所选节点邻域再显露一圈，不重排或缩放当前画布' : focus ? '此连通邻域已全部显露；可从锚点或节点索引进入独立路径' : '先选择节点或探索锚点';
    paintFocus();
  }
  function stopMotion() {
    clearInterval(motionTimer); motionTimer = null;
    cy?.edges('.is-moving').removeClass('is-moving').removeStyle('line-dash-offset').removeStyle('opacity');
  }
  function updateMotion() {
    stopMotion();
    if (!cy || destroyed || reducedMotion.matches || !root.isConnected || hover || (!focus && !selectedEdge)) return;
    const moving = cy.edges('.is-traced').not('.is-hidden');
    if (!moving.length) return;
    moving.addClass('is-moving');
    // Selection pulses never change the original semantic line style. Only
    // already dashed/dotted relations move their own pattern along the arrow.
    motionTimer = setInterval(() => {
      if (!destroyed && root.isConnected && !document.hidden) {
        motionOffset = (motionOffset - 1) % 120;
        moving.style('opacity', 0.86 + 0.14 * Math.sin(motionOffset / 8));
        moving.filter(edge => relations[edge.data('kind')]?.line !== 'solid').style('line-dash-offset', motionOffset);
      }
    }, 90);
  }
  function paintFocus() {
    if (!cy) return;
    const activeEdge = hover?.type === 'edge' ? hover.id : hover ? null : selectedEdge;
    const activeNode = hover?.type === 'node' ? hover.id : hover ? null : selectedEdge ? null : focus;
    const related = activeNode ? endsOf(activeNode) : new Set();
    if (activeEdge) {
      const r = edgeRecords.get(activeEdge);
      if (r) { related.add(r.from_id); related.add(r.to_id); }
    }
    const active = Boolean(activeNode || activeEdge);
    cy.batch(() => {
      cy.elements().removeClass('is-dim is-neighbor is-focus is-traced is-edge-focus');
      if (active) {
        cy.nodes().forEach(node => {
          node.toggleClass('is-dim', !related.has(node.id()));
          node.toggleClass('is-neighbor', related.has(node.id()));
          node.toggleClass('is-focus', node.id() === activeNode || activeEdge && related.has(node.id()));
        });
        cy.edges().forEach(edge => {
          const r = edgeRecords.get(edge.id());
          const traced = activeEdge ? edge.id() === activeEdge : r.from_id === activeNode || r.to_id === activeNode;
          edge.toggleClass('is-dim', !traced).toggleClass('is-traced', traced);
          edge.toggleClass('is-edge-focus', edge.id() === activeEdge);
        });
      }
    });
    updateMotion();
  }
  function previewElement(target) {
    hover = target;
    if (target?.type === 'node') {
      const node = nodes.get(target.id);
      preview.textContent = `${node.name} · ${direct(node.id).length} 条直接关系；点击锁定邻域。`;
    } else if (target?.type === 'edge') {
      const r = edgeRecords.get(target.id);
      preview.textContent = `${nodes.get(r.from_id).name} — ${relationLabel(r)} → ${nodes.get(r.to_id).name}：${r.statement || r.explanation || '原文见详情'}（点击查看范围与证据）`;
    } else preview.textContent = selectedEdge ? '已锁定原关系；下方可查看适用范围与原文证据。' : focus ? '已锁定直接入边、出边与邻居；悬停可临时预览其他邻域。' : presentation.note;
    paintFocus();
  }
  function renderAuxiliary() {
    const key = focus || '';
    if (auxiliaryKey === key) return;
    auxiliaryKey = key;
    auxiliary.hidden = !nodes.has(focus);
    auxiliary.replaceChildren();
    anchor.value = focus || '';
    if (!nodes.has(focus)) return;
    const relations = direct(focus), incoming = relations.filter(r => r.to_id === focus).length;
    const ids = [...new Set(graph.participations.filter(p => p.node_id === focus).map(p => p.company_id))];
    auxiliary.append(el('div', { class: 'ai-selected-identity' }, el('strong', {}, nodes.get(focus).name),
      el('span', {}, `${KINDS[nodes.get(focus).kind] || nodes.get(focus).kind} · ${relations.length} 条直接关系 · ${incoming} 入 / ${relations.length - incoming} 出 · ${ids.length} 家公司`)),
      el('div', { class: 'ai-selection-actions' }, button('节点 / 原文', 'ai-detail'),
        ...ids.filter(id => companies.has(id)).map(id => button(companyLabel(companies.get(id)), 'ai-company', id, { 'data-node-id': focus, title: companies.get(id).name }))),
      el('details', {}, el('summary', {}, '直接关系与端点'), el('ul', {}, ...relations.map(r => el('li', {},
        button(nodes.get(r.from_id).name, 'node', r.from_id), ` — ${relationLabel(r)} → `,
        button(nodes.get(r.to_id).name, 'node', r.to_id), command('范围 / 原文', 'edge', { 'data-edge-id': [...edgeRecords].find(([, record]) => record === r)[0] }))))));
  }
  function renderEdgeDetail() {
    edgeDetail.hidden = !selectedEdge;
    if (detailKey === (selectedEdge || '')) return;
    detailKey = selectedEdge || '';
    edgeDetail.replaceChildren();
    const r = edgeRecords.get(selectedEdge);
    if (!r) return;
    edgeDetail.append(el('div', { class: 'ai-edge-detail-heading' }, el('h3', {}, '原关系 · ', relationLabel(r)), command('关闭线详情', 'close-edge')),
      el('div', { class: 'ai-edge-endpoints' }, button(nodes.get(r.from_id).name, 'node', r.from_id), el('span', {}, '→'), button(nodes.get(r.to_id).name, 'node', r.to_id)),
      el('p', { class: 'ai-edge-statement' }, r.statement || r.explanation || '原记录未提供说明。'),
      el('p', { class: 'ai-edge-status' }, `${r.id || '关系编号见原记录'} · ${r.kind} · ${r.origin || '来源见原记录'} · ${r.review_status || '核查状态见原记录'}${graph.status === 'draft' ? ' · 研究草稿 / 未发布 / 待核查' : ''}`),
      el('details', {}, el('summary', {}, '完整适用范围'), el('pre', {}, typeof r.applicability === 'string' ? r.applicability : JSON.stringify(r.applicability ?? '原记录未提供', null, 2))),
      renderEvidence ? renderEvidence(r) : el('p', {}, '证据与原文见端点的节点详情。'));
  }
  function selectEdge(id, fromIndex = false) {
    if (!edgeRecords.has(id)) return;
    selectedEdge = id; hover = null;
    refreshVisibility(true); renderEdgeDetail(); previewElement(null);
    if (cy && fromIndex) {
      const r = edgeRecords.get(id);
      cy.fit(cy.getElementById(r.from_id).union(cy.getElementById(r.to_id)), 100);
    }
    if (fromIndex) {
      board.scrollIntoView({ block: 'nearest' });
      edgeDetail.focus({ preventScroll: true });
    }
  }
  function fit() {
    if (!cy) { fitPending = true; return; }
    const showing = cy.elements().not('.is-hidden');
    if (showing.length) cy.fit(showing, 42);
    fitPending = false;
  }
  function ensureOnscreen(id) {
    if (!cy || initialFit || !nodes.has(id)) return;
    const node = cy.getElementById(id), p = node.renderedPosition();
    if (p.x < 95 || p.x > cy.width() - 95 || p.y < 45 || p.y > cy.height() - 45) cy.center(node);
  }
  function sync(selection) {
    const next = selection.type === 'node' ? selection.id : selection.type === 'company' ? selection.nodeId : null;
    const valid = nodes.has(next) ? next : null, changed = valid !== focus;
    if (changed) { selectedEdge = null; hover = null; explored = endsOf(valid); }
    focus = valid;
    refreshVisibility(changed); renderAuxiliary(); renderEdgeDetail();
    if (changed) { previewElement(null); ensureOnscreen(focus); }
  }
  function expansionRing(id) {
    let region = id === focus && explored.size ? new Set(explored) : endsOf(id);
    // Skip already visible rings, stopping at the first hidden frontier. This
    // makes repeat expansion useful even when selection revealed direct ends.
    while (region.size) {
      const next = new Set(region);
      region.forEach(end => endsOf(end).forEach(neighbor => next.add(neighbor)));
      const hidden = [...next].filter(end => !visible.has(end));
      if (hidden.length || next.size === region.size) return { next, hidden };
      region = next;
    }
    return { next: region, hidden: [] };
  }
  function expandNeighbors(id = focus) {
    if (!nodes.has(id)) return;
    const ring = expansionRing(id);
    explored = ring.next;
    ring.next.forEach(end => expanded.add(end));
    refreshVisibility(true);
  }
  function expandAll(all) {
    explored = endsOf(focus);
    expanded.clear();
    if (all) expanded.add('__all');
    refreshVisibility(true);
    fit();
  }
  function overview() {
    selectedEdge = null; hover = null;
    expanded.clear(); refreshVisibility(); renderEdgeDetail(); previewElement(null); fit();
  }
  function zoom(factor) {
    if (!cy) return;
    cy.zoom({ level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }
  function setLarge(large) {
    root.classList.toggle('is-large', large);
    if (large) { root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); }
    else { root.removeAttribute('role'); root.removeAttribute('aria-modal'); }
    document.body.classList.toggle('ai-graph-focus-open', large);
    focusButton.textContent = large ? '退出大图 · Esc' : '展开大图';
    focusButton.setAttribute('aria-pressed', String(large));
    // resize() keeps the user's zoom and pan; only an explicit fit resets them.
    requestAnimationFrame(() => { if (!destroyed) { layout(); if (large) { fit(); board.focus({ preventScroll: true }); } } });
  }
  function onCommand(event) {
    if (root.classList.contains('is-large') && event.target.closest('[data-action="ai-detail"], [data-action="ai-company"]')) setLarge(false);
    // A real node choice must unlock an internally selected edge even if the
    // host node ID is unchanged. Let the host own node/company/URL selection.
    if (event.target.closest('[data-action="node"]')) {
      selectedEdge = null; hover = null; renderEdgeDetail(); previewElement(null);
      if (!canvasChoosing && event.target.closest('.ai-node-index')) board.scrollIntoView({ block: 'nearest' });
    }
    const target = event.target.closest('[data-ai-command]');
    if (!target || !root.contains(target)) return;
    event.stopPropagation();
    const name = target.dataset.aiCommand;
    if (name === 'in') zoom(1.2);
    else if (name === 'out') zoom(1 / 1.2);
    else if (name === 'fit') fit();
    else if (name === 'neighbors') expandNeighbors();
    else if (name === 'all') expandAll(true);
    else if (name === 'main') expandAll(false);
    else if (name === 'large') setLarge(!root.classList.contains('is-large'));
    else if (name === 'edge') selectEdge(target.dataset.edgeId, true);
    else if (name === 'close-edge') { selectedEdge = null; hover = null; renderEdgeDetail(); previewElement(null); }
    if (['neighbors', 'all', 'main'].includes(name)) onViewChange?.();
  }
  function onKey(event) {
    if (event.key === 'Tab' && root.classList.contains('is-large')) {
      const focusables = [...root.querySelectorAll('button:not(:disabled), input, select, a[href], summary, [tabindex="0"]')]
        .filter(item => item.getClientRects().length && !item.closest('[hidden]'));
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.key === 'Escape' && (root.classList.contains('is-large') || selectedEdge || hover)) {
      event.preventDefault(); event.stopPropagation();
      if (root.classList.contains('is-large')) { setLarge(false); focusButton.focus({ preventScroll: true }); }
      else { selectedEdge = null; hover = null; renderEdgeDetail(); previewElement(null); board.focus({ preventScroll: true }); }
      return;
    }
    if (event.target !== board || !cy) return;
    const pans = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (pans[event.key]) { const [x, y] = pans[event.key]; cy.panBy({ x, y }); }
    else if (event.key === '+' || event.key === '=') zoom(1.2);
    else if (event.key === '-' || event.key === '−') zoom(1 / 1.2);
    else if (event.key === '0') fit();
    else return;
    event.preventDefault(); event.stopPropagation();
  }
  root.addEventListener('click', onCommand);
  root.addEventListener('keydown', onKey);
  anchor.addEventListener('change', () => { if (nodes.has(anchor.value)) nodeButtons.get(anchor.value).click(); });
  indexSearch.addEventListener('input', () => {
    const query = indexSearch.value.trim().toLowerCase();
    let count = 0;
    indexRows.forEach((row, id) => {
      row.hidden = !`${nodes.get(id).name} ${short(id)} ${presentation.groupTitles?.get(id) || ''}`.toLowerCase().includes(query);
      if (!row.hidden) count++;
    });
    indexCount.textContent = `${count} 个节点`;
  });
  const onMotionChange = () => updateMotion();
  reducedMotion.addEventListener?.('change', onMotionChange);

  function layout() {
    if (destroyed || !board.isConnected || board.clientWidth <= 0 || board.clientHeight <= 0) return;
    if (!cy) {
      const elements = graph.nodes.map(node => ({ data: { id: node.id, kind: node.kind, label: short(node.id) },
        position: positions.get(node.id),
        classes: `${support.has(node.id) ? 'support' : reference.has(node.id) ? 'reference' : 'branch'}${visible.has(node.id) ? '' : ' is-hidden'}` }));
      edgeRecords.forEach((r, id) => {
        const special = presentation.edgeClass?.(r) || '';
        elements.push({ data: { id, source: r.from_id, target: r.to_id, kind: r.kind, relationLabel: relationLabel(r) },
          classes: `${special}${visible.has(r.from_id) && visible.has(r.to_id) ? '' : ' is-hidden'}` });
      });
      cy = cytoscape({ container: board, elements, style: graphStyle(relations, presentation), layout: { name: 'preset', fit: false },
        minZoom: 0.22, maxZoom: 2.4, wheelSensitivity: 0.18, boxSelectionEnabled: false,
        autounselectify: true, selectionType: 'single', motionBlur: false });
      cy.on('tap', 'node', event => {
        canvasChoosing = true;
        try { nodeButtons.get(event.target.id())?.click(); }
        finally { canvasChoosing = false; }
      });
      cy.on('tap', 'edge', event => selectEdge(event.target.id()));
      cy.on('mouseover', 'node', event => previewElement({ type: 'node', id: event.target.id() }));
      cy.on('mouseover', 'edge', event => previewElement({ type: 'edge', id: event.target.id() }));
      cy.on('mouseout', 'node, edge', () => previewElement(null));
      cy.on('tap', event => { if (event.target === cy) { selectedEdge = null; hover = null; renderEdgeDetail(); previewElement(null); } });
      cy.on('zoom', () => { zoomReading.textContent = `${Math.round(cy.zoom() * 100)}%`; });
      cy.on('grab', 'node', () => previewElement(null));
      // No layout reruns: dragged positions live only in this engine instance.
      refreshVisibility();
    }
    const size = `${board.clientWidth}:${board.clientHeight}`;
    if (size !== lastSize) { cy.resize(); lastSize = size; }
    if (initialFit) {
      if (focus) {
        let neighborhood = cy.collection();
        endsOf(focus).forEach(id => { neighborhood = neighborhood.union(cy.getElementById(id)); });
        cy.fit(neighborhood, 80);
        if (cy.zoom() > 1.15) {
          cy.zoom(1.15);
          cy.center(neighborhood);
        }
      } else fit();
      initialFit = false;
    } else if (fitPending) fit();
  }
  function destroy() {
    destroyed = true;
    stopMotion(); clearTimeout(revealTimer);
    reducedMotion.removeEventListener?.('change', onMotionChange);
    root.removeEventListener('click', onCommand); root.removeEventListener('keydown', onKey);
    document.body.classList.remove('ai-graph-focus-open');
    cy?.destroy(); cy = null;
  }
  refreshVisibility();
  return { root, board, sync, toggle: expandNeighbors, expandAll, overview, layout, destroy };
}

const AI_COMPANY_LABELS = {
  "company_cambricon": "寒武纪",
  "company_shanghai_cambricon": "上海寒武纪",
  "company_montage": "澜起科技",
  "company_fii": "工业富联",
  "company_cnt_singapore": "CNT Singapore",
  "company_inspur_info": "浪潮信息",
  "company_zhongji_innolight": "中际旭创",
  "company_envicool": "英维克",
  "company_runze_tech": "润泽科技",
  "company_baosight": "宝信软件",
  "company_eoptolink": "新易盛",
  "company_sugon": "中科曙光",
  "company_kehua_data": "科华数据",
  "company_hygon": "海光信息",
  "company_sk_hynix": "SK hynix",
  "company_micron": "Micron",
  "company_tsmc": "TSMC",
  "company_nvidia": "NVIDIA"
};
export function aiCompanyLabel(company) { return AI_COMPANY_LABELS[company.id] || company.name; }

export function renderAiCompanies({ graph, el, button, codeOf, view, readingGroups = aiReadingGroups(graph), companyLabel = aiCompanyLabel }) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const companies = new Map(graph.companies.map(company => [company.id, company]));
  const companyCode = company => company.securities?.length > 1 ? company.securities.join(' / ') : codeOf(company) === '无明确证券映射' ? '' : codeOf(company);
  const companyButton = (company, part = null) => button([
    el('strong', {}, companyLabel(company)), companyCode(company) ? el('span', { class: 'ai-company-code' }, companyCode(company)) : null
  ], 'ai-company', company.id, {
    class: 'ai-company-link', title: company.name, 'aria-label': `${company.name}${companyCode(company) ? '，' + companyCode(company) : ''}，查看公司详情`,
    'data-node-id': part?.node_id, 'data-role-index': part ? graph.participations.indexOf(part) : null,
    'aria-pressed': 'false'
  });
  if (view === 'companies') return el('div', { class: 'ai-company-correspondence ai-company-first' }, ...graph.companies.map(company => {
    const ids = [...new Set(graph.participations.filter(part => part.company_id === company.id).map(part => part.node_id))];
    return el('div', { class: 'ai-company-line', 'data-row-company': company.id }, companyButton(company),
      el('div', { class: 'ai-company-names' }, ids.length ? ids.map(id => button(nodes.get(id).name, 'node', id, { class: 'ai-correspondence-node', 'aria-pressed': 'false' })) : el('span', { class: 'ai-company-code' }, '未收录环节')));
  }));
  return el('div', { class: 'ai-company-correspondence' }, ...readingGroups.flatMap(group => {
    const ids = group.ids.filter(id => graph.participations.some(part => part.node_id === id));
    if (!ids.length) return [];
    return [el('section', { class: 'ai-company-module' }, el('h3', {}, group.title), ...ids.map(id => {
      const seen = new Set(), parts = graph.participations.filter(part => part.node_id === id).filter(part => {
        if (seen.has(part.company_id)) return false;
        seen.add(part.company_id); return true;
      });
      return el('div', { class: 'ai-company-line' },
        el('h4', { 'data-node': id }, button(nodes.get(id).name, 'node', id, { class: 'ai-correspondence-node', 'aria-pressed': 'false' })),
        el('div', { class: 'ai-company-names' }, ...parts.map(part => companyButton(companies.get(part.company_id), part))));
    }))];
  }));
}
