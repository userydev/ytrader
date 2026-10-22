// Presentation only: slots, labels and overview membership never modify facts.
// All arrows, their direction and applicability come from graph.relations.
export function usesChainLayout(graph) {
  // Availability, not an industry whitelist. Empty/unloaded and source graphs
  // keep their existing host path; no placeholder nodes or relations are made.
  return graph?.source_kind === 'curated_v02' && Boolean(graph.industry?.id) &&
    Array.isArray(graph.nodes) && graph.nodes.length > 0 && Array.isArray(graph.relations);
}

// Slots are [column, row, optional display label]. These are not process edges.
// The reviewed AI preset remains in ai-layout.js; no AI slot is used by another chain.
const LAYOUTS = {
  'crude-oil': {
    prefix: 'node:',
    note: '资源开发、炼制用途与润滑油再生分区阅读；油田配套和营销按原关系展开。再生润滑油馏分不是原油；位置不补造工艺、供货或新闻因果关系。',
    main: ['petroleum-geological-exploration', 'petroleum-exploratory-drilling', 'petroleum-development-wells', 'crude-oil-production', 'crude-petroleum', 'petroleum-refining', 'petroleum-fuels', 'petrochemical-feedstocks', 'petroleum-nonfuel-products', 'transport-fuel-applications', 'petrochemical-production', 'petroleum-transport', 'oilfield-technical-services', 'lubricating-oils', 'lubricating-oil-use', 'used-lubricating-oil', 'used-oil-rerefining', 'base-oil'],
    supportGroups: ['support', 'delivery'],
    slots: {
      'petroleum-geological-exploration': [0, 0, '油气地质 / 地球物理勘探'],
      'petroleum-exploratory-drilling': [1, 0],
      'petroleum-development-wells': [2, 0, '开发井与完井'],
      'crude-oil-production': [3, 0, '原油采出 / 油田生产'],
      'crude-petroleum': [4, 0],
      'oilfield-technical-services': [2, 1],
      'petroleum-transport': [3, 1, '原油 / 成品油运输'],
      'petroleum-refining': [4, 1],
      'transport-fuel-applications': [0, 2],
      'petroleum-fuels': [1, 2],
      'petroleum-nonfuel-products': [2, 2, '润滑油 / 沥青等非燃料'],
      'petrochemical-feedstocks': [3, 2],
      'petrochemical-production': [4, 2],
      'base-oil': [0, 3, '再生润滑油馏分'],
      'used-oil-rerefining': [1, 3],
      'used-lubricating-oil': [2, 3],
      'lubricating-oil-use': [3, 3],
      'lubricating-oils': [4, 3],
      'fracturing-fluids-proppants': [0, 4, '压裂水 / 化学剂 / 支撑剂'],
      'hydraulic-fracturing-services': [1, 4],
      'enhanced-oil-recovery-services': [2, 4, '注入增产 / 辅助采油'],
      'offshore-field-engineering': [0, 5],
      'offshore-facility-construction': [1, 5, '海上设施建造与安装'],
      'offshore-production-facilities': [2, 5, '海上平台 / 水下设施'],
      'offshore-support-vessels': [0, 6],
      'offshore-well-abandonment': [1, 6, '海上井弃置 / 设施拆除'],
      'petroleum-tank-storage': [5, 0],
      'crude-oil-sales-trading': [5, 1, '原油 / 油品销售贸易'],
      'petroleum-distillation': [5, 2, '常压 / 适用减压蒸馏'],
      'petroleum-fractions': [6, 2],
      'petroleum-conversion': [6, 3],
      'petroleum-reforming': [6, 1],
      'refinery-hydrogen-catalysts': [6, 4, '炼制用氢 / 催化剂接口'],
      'petroleum-treatment-blending': [5, 4],
      'stationary-petroleum-fuel-applications': [0, 1, '石油燃料供热 / 发电'],
      'petroleum-products-marketing': [1, 1, '成品油批零与营销'],
      'bitumen-extender': [3, 6, '再精炼残渣沥青调和用途料']
    }
  },
  gold: {
    prefix: 'gold:',
    note: '采选冶炼、适用矿性支路、再生供给和制品用途分区阅读；副产回收金、装备检验与技术咨询保留独立入口，不补造连接或统一矿石工艺。',
    main: ['exploration', 'mining', 'rom_ore', 'crushing_milling', 'prepared_ore', 'leaching_recovery', 'gold_dore', 'refining_process', 'fine_gold', 'jewellery_manufacturing', 'jewellery_products', 'minting_bars_coins', 'investment_bullion', 'electronics_application', 'gold_scrap', 'gold_scrap_recycling', 'base_metal_processing', 'byproduct_gold', 'technical_services'],
    supportGroups: ['support', 'tailings'],
    slots: {
      exploration: [0, 0], mining: [1, 0], rom_ore: [2, 0],
      crushing_milling: [3, 0, '破碎 / 磨矿 / 分级'], prepared_ore: [4, 0, '破碎磨细的含金物料'],
      leaching_recovery: [4, 1, '浸出吸附 / 解吸 / 金房回收'], gold_dore: [3, 1],
      refining_process: [2, 1], fine_gold: [2, 2],
      jewellery_manufacturing: [3, 2], jewellery_products: [4, 2],
      minting_bars_coins: [2, 3], investment_bullion: [3, 3, '金条 / 金币等实物制品'],
      electronics_application: [1, 3],
      gold_scrap: [0, 2], gold_scrap_recycling: [1, 2, '废金加工 / 二次精炼'],
      base_metal_processing: [0, 4, '有色矿处理 / 副产金回收接口'], byproduct_gold: [1, 4, '有色矿处理副产回收金'],
      technical_services: [4, 4, '黄金生产研发 / 咨询服务'],
      flotation: [5, 0], gold_concentrate: [6, 0],
      pre_treatment: [6, 1], pretreated_feed: [5, 1, '适于后续浸出的预处理物料'],
      jewellery_marketing: [5, 2], jewellery_application: [6, 2],
      bullion_marketing: [4, 3, '合质金 / 标准金 / 制品销售'], investment_application: [5, 3], reserve_application: [6, 3],
      leach_residues: [5, 4], tailings_handling: [6, 4],
      grinding_equipment: [3, -1], equipment_manufacturing: [0, -1], mining_equipment: [1, -1],
      assay_services: [0, 5], quality_assurance: [1, 5, '申请样本 / 金锭质量验证']
    }
  },
  grid: {
    prefix: 'grid:',
    note: '材料制造、交流 / 直流装备与运行服务分支并列；工程与运维为独立分量。位置不补充输变配连接、设备兼容或供货关系。',
    main: ['winding_metals', 'electrical_steel', 'transformer_manufacturing', 'power_transformer', 'converter_transformer', 'equipment_manufacturing', 'power_line_cable', 'converter_valve', 'substation_operation', 'ac_transmission_activity', 'hvdc_transmission_activity', 'distribution_operation', 'power_distribution_service', 'industrial_power_consumption', 'residential_power_consumption', 'grid_engineering_service', 'grid_construction_activity', 'grid_maintenance_service', 'grid_maintenance_activity'],
    supportGroups: ['control', 'engineering'],
    slots: {
      winding_metals: [0, 0], electrical_steel: [0, 1],
      transformer_manufacturing: [1, 0], power_transformer: [2, 0], substation_operation: [3, 0],
      converter_transformer: [2, 1], hvdc_transmission_activity: [3, 1],
      equipment_manufacturing: [0, 2], converter_valve: [1, 1],
      power_line_cable: [1, 2], ac_transmission_activity: [2, 2],
      distribution_operation: [2, 3], power_distribution_service: [3, 3],
      industrial_power_consumption: [4, 3], residential_power_consumption: [4, 4],
      grid_engineering_service: [0, 4, '电网工程 / 系统集成服务'], grid_construction_activity: [1, 4],
      grid_maintenance_service: [0, 5], grid_maintenance_activity: [1, 5],
      reactor: [4, 0], gis_switchgear: [5, 0], ac_circuit_breaker: [6, 0],
      dc_circuit_breaker: [4, 1], surge_arrester: [5, 1], insulation_accessories: [6, 1],
      ac_transmission_service: [3, 2], hvdc_transmission_service: [4, 2],
      submarine_power_cable: [0, 3], submarine_cable_engineering: [1, 3],
      relay_protection_device: [5, 2], dispatch_automation_system: [5, 3], dispatch_control_activity: [6, 2, '调度监控 / 继电保护运行'],
      reactive_compensation: [5, 4, '无功补偿 / 有源滤波装备'], power_quality_activity: [6, 4]
    }
  },
  'innovative-drugs': {
    prefix: 'innovative-drugs:',
    note: '研究数据与审评、小分子 / 抗体制造及渠道按原关系分区；不把审评位置画成获批上市，不补造研发到制造的连线；受托服务按需展开。',
    main: ['discovery', 'candidate', 'preclinical', 'preclinical_data', 'clinical_trials', 'clinical_data', 'regulatory_submission', 'regulatory_dossier', 'regulatory_review', 'api_starting_materials', 'api_manufacturing', 'api_substance', 'cell_culture', 'culture_harvest', 'mab_purification', 'biologic_substance', 'drug_product_manufacturing', 'finished_drug', 'medical_application', 'bioanalysis_services', 'bioanalysis_activity'],
    supportGroups: ['cxo'],
    slots: {
      discovery: [0, 0, '药物发现 / 筛选优化'], candidate: [0, 1], preclinical: [1, 0],
      preclinical_data: [1, 1], clinical_trials: [2, 0], clinical_data: [2, 1],
      regulatory_submission: [3, 1], regulatory_dossier: [4, 1], regulatory_review: [4, 0],
      api_starting_materials: [0, 2], api_manufacturing: [1, 2], api_substance: [2, 2],
      cell_culture: [0, 3, '细胞培养 / 发酵表达'], culture_harvest: [1, 3], mab_purification: [2, 3], biologic_substance: [3, 3],
      drug_product_manufacturing: [3, 2], finished_drug: [4, 2], medical_application: [4, 3],
      bioanalysis_services: [0, 4, '生物分析 / 临床样本检测服务'], bioanalysis_activity: [1, 4],
      process_development: [0, 5], process_development_services: [1, 5],
      biologic_manufacturing: [2, 4], chromatography_media: [3, 4], excipients: [4, 4], quality_testing: [2, 5],
      drug_commercialization: [5, 2], drug_distribution_services: [5, 3], post_market_monitoring: [6, 2], post_market_services: [6, 3],
      discovery_services: [0, -1], preclinical_services: [1, -1], clinical_services: [2, -1], pharmacovigilance_services: [3, -1],
      contract_manufacturing_services: [3, 5], clinical_data_processing: [5, 0], clinical_data_services: [6, 0]
    }
  }
};

// Use original group titles/membership/order, keeping unknown nodes accessible.
export function structureReadingGroups(graph) {
  const available = new Set(graph.nodes.map(node => node.id)), seen = new Set();
  const raw = graph.structure?.groups || [];
  const order = [...new Set([...(graph.structure?.reading_order || []), ...raw.map(group => group.id)])];
  const groups = order.map(id => raw.find(group => group.id === id)).filter(Boolean).map(group => ({
    id: group.id, title: group.title, role: group.role,
    ids: (group.node_ids || []).filter(id => {
      if (!available.has(id) || seen.has(id)) return false;
      seen.add(id); return true;
    })
  })).filter(group => group.ids.length);
  const rest = graph.nodes.map(node => node.id).filter(id => !seen.has(id));
  if (rest.length) groups.push({ id: 'other', title: '其他已收录节点', ids: rest });
  return groups;
}

function componentsOf(graph) {
  const neighbors = new Map(graph.nodes.map(node => [node.id, new Set()]));
  graph.relations.forEach(r => {
    neighbors.get(r.from_id)?.add(r.to_id);
    neighbors.get(r.to_id)?.add(r.from_id);
  });
  const unseen = new Set(neighbors.keys()), components = [];
  while (unseen.size) {
    const stack = [unseen.values().next().value], ids = [];
    unseen.delete(stack[0]);
    while (stack.length) {
      const id = stack.pop(); ids.push(id);
      neighbors.get(id)?.forEach(next => { if (unseen.delete(next)) stack.push(next); });
    }
    components.push(ids);
  }
  return components;
}

// Generic presentation uses only original groups and real adjacency. Nothing
// here depends on selection/visibility; the engine receives all positions once.
function genericStructureLayout(graph) {
  const groups = structureReadingGroups(graph).map(group => ({ ...group, ids: [...group.ids].sort() }));
  const ordered = groups.flatMap(group => group.ids);
  const rank = new Map(ordered.map((id, index) => [id, index]));
  const compare = (a, b) => rank.get(a) - rank.get(b);
  const outgoing = new Map(ordered.map(id => [id, new Set()]));
  const adjacent = new Map(ordered.map(id => [id, new Set()]));
  const preferred = new Map(ordered.map(id => [id, new Set()]));
  const primary = new Set(graph.structure?.primary_relation_ids || []);
  graph.relations.forEach(relation => {
    const { from_id: from, to_id: to } = relation;
    if (!rank.has(from) || !rank.has(to)) return;
    outgoing.get(from).add(to);
    adjacent.get(from).add(to); adjacent.get(to).add(from);
    if (primary.has(relation.id)) preferred.get(from).add(to);
  });
  outgoing.forEach((ids, id) => outgoing.set(id, [...ids].sort((a, b) =>
    Number(preferred.get(id).has(b)) - Number(preferred.get(id).has(a)) || compare(a, b))));
  adjacent.forEach((ids, id) => adjacent.set(id, [...ids].sort(compare)));
  const components = componentsOf(graph).map(ids => ids.sort(compare)).sort((a, b) => compare(a[0], b[0]));
  const overview = new Set(), reference = new Set(), reading = new Map();

  components.forEach(ids => {
    // Longest of the directed shortest paths: readable real paths without
    // pretending a cycle is a DAG, or using exponential longest-path search.
    // Each BFS visits a node once, including self-loops and parallel relations.
    let path = [ids[0]];
    ids.forEach(start => {
      const queue = [start], parent = new Map([[start, null]]), depth = new Map([[start, 0]]);
      let end = start;
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        outgoing.get(id).forEach(next => {
          if (parent.has(next)) return;
          parent.set(next, id); depth.set(next, depth.get(id) + 1); queue.push(next);
          if (depth.get(next) > depth.get(end)) end = next;
        });
      }
      if (depth.get(end) + 1 > path.length) {
        path = [];
        for (let id = end; id !== null; id = parent.get(id)) path.push(id);
        path.reverse();
      }
    });
    path.forEach(id => {
      overview.add(id);
      if (path.length > 1) reference.add(id); // Isolated entries do not imply a relation path.
    });
    const members = new Set(ids);
    groups.forEach(group => {
      const targets = new Set(group.ids.filter(id => members.has(id)));
      if (!targets.size || [...targets].some(id => overview.has(id))) return;
      // Bring each group's entry in along an actual undirected neighborhood
      // route to the visible path. Original arrow directions are never changed.
      const queue = ids.filter(id => overview.has(id));
      const parent = new Map(queue.map(id => [id, null]));
      let entry = null;
      for (let i = 0; i < queue.length && entry === null; i++) {
        const id = queue[i];
        for (const next of adjacent.get(id)) {
          if (parent.has(next)) continue;
          parent.set(next, id); queue.push(next);
          if (targets.has(next)) { entry = next; break; }
        }
      }
      for (let id = entry; id !== null; id = parent.get(id)) overview.add(id);
    });
    // Place path nodes in reading order, then their real neighbors. Sorting
    // adjacency makes equal input facts stable even if API arrays are reordered.
    const queue = [...path], seen = new Set(path);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]; reading.set(id, reading.size);
      adjacent.get(id).forEach(next => { if (!seen.has(next)) { seen.add(next); queue.push(next); } });
    }
  });

  // Original groups become compact two-dimensional tiles. Shelf packing uses
  // full-graph area, so many groups and a single large group both grow in 2D.
  const tiles = groups.map(group => {
    const ids = [...group.ids].sort((a, b) => reading.get(a) - reading.get(b));
    const columns = Math.ceil(Math.sqrt(ids.length));
    return { ids, columns, width: columns * 250 + 80, height: Math.ceil(ids.length / columns) * 125 + 80 };
  });
  const shelfWidth = Math.max(...tiles.map(tile => tile.width),
    Math.ceil(Math.sqrt(tiles.reduce((area, tile) => area + tile.width * tile.height, 0) * 1.6)));
  const positions = new Map();
  let x = 0, y = 0, shelfHeight = 0;
  tiles.forEach(tile => {
    if (x && x + tile.width > shelfWidth) { y += shelfHeight; x = 0; shelfHeight = 0; }
    tile.ids.forEach((id, index) => {
      const row = Math.floor(index / tile.columns), column = index % tile.columns;
      positions.set(id, { x: 105 + x + (row % 2 ? tile.columns - 1 - column : column) * 250, y: 100 + y + row * 125 });
    });
    x += tile.width; shelfHeight = Math.max(shelfHeight, tile.height);
  });
  return { positions, labels: new Map(), overview, reference,
    support: new Set(groups.filter(group => group.role === 'support').flatMap(group => group.ids)),
    groupTitles: new Map(groups.flatMap(group => group.ids.map(id => [id, group.title]))),
    note: '按原分组分区；主干保留真实有向路径、各组与独立分量入口。位置和边框仅辅助阅读，不表示工艺顺序、供货或兼容；孤点不补线，可展开邻域或查看全部。',
    nodeStyle: { width: 196, height: 74, 'font-size': 18, 'text-max-width': 180 },
    referenceLabel: '蓝框 · 原关系路径', branchLabel: '绿框 · 分组 / 独立支路', supportLabel: '暖框 · 原分组配套' };
}

export function structureLayout(graph) {
  if (!usesChainLayout(graph) || graph.industry.id === 'ai-compute') return null;
  // AI remains exclusively on reviewedAiPresentation in the shared adapter.
  const spec = Object.prototype.hasOwnProperty.call(LAYOUTS, graph.industry.id) ? LAYOUTS[graph.industry.id] : null;
  if (!spec) return genericStructureLayout(graph);
  const groups = structureReadingGroups(graph), positions = new Map(), labels = new Map();
  graph.nodes.forEach(node => {
    const key = node.id.startsWith(spec.prefix) ? node.id.slice(spec.prefix.length) : '';
    const slot = Object.prototype.hasOwnProperty.call(spec.slots, key) ? spec.slots[key] : null;
    if (slot) {
      positions.set(node.id, { x: 105 + slot[0] * 250, y: 100 + slot[1] * 125 });
      if (slot[2]) labels.set(node.id, slot[2]);
    }
  });
  const reference = new Set(spec.main.map(id => spec.prefix + id).filter(id => positions.has(id)));
  const overview = new Set(reference);
  const support = new Set(groups.filter(group => spec.supportGroups.includes(group.id)).flatMap(group => group.ids));
  // Future nodes use stable compact component tiles, not an unbounded pipeline.
  // No tile overlaps known slots or another component; existing slots never move.
  const ordered = groups.flatMap(group => group.ids);
  let fallbackY = Math.max(100, ...[...positions.values()].map(p => p.y)) + 180;
  let shelfX = 0, shelfHeight = 0;
  componentsOf(graph).forEach(ids => {
    const members = new Set(ids);
    const missing = ordered.filter(id => members.has(id) && !positions.has(id)).sort();
    if (missing.length) {
      const columns = Math.min(missing.length, 4, Math.ceil(Math.sqrt(missing.length * 1.5)));
      const tileWidth = columns * 250 + 50;
      if (shelfX && shelfX + tileWidth > 1800) {
        fallbackY += shelfHeight; shelfX = 0; shelfHeight = 0;
      }
      missing.forEach((id, index) => positions.set(id, {
        x: 105 + shelfX + index % columns * 250, y: fallbackY + Math.floor(index / columns) * 125
      }));
      shelfX += tileWidth;
      shelfHeight = Math.max(shelfHeight, Math.ceil(missing.length / columns) * 125 + 80);
    }
    // Every independent component has a default entry, including isolated nodes.
    if (!ids.some(id => overview.has(id))) overview.add(ordered.find(id => members.has(id)) || ids[0]);
  });
  return { positions, labels, overview, reference, support, note: spec.note,
    groupTitles: new Map(groups.flatMap(group => group.ids.map(id => [id, group.title]))),
    nodeStyle: { width: 196, height: 74, 'font-size': 18, 'text-max-width': 180 },
    referenceLabel: '蓝框 · 展示骨架', branchLabel: '绿框 · 已收录支路', supportLabel: '暖框 · 配套 / 接口' };
}
