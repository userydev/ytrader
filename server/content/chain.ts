import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from '../db.js';
import { ApiError } from '../auth.js';
import {
  type ChainSummary,
  type ChainGraphNode,
  type ChainGraphEdge,
  type NodeCompanyExposure,
  type NodeLogicCard,
  type NodeDetailResponse,
  type ChainGraphResponse,
  type ChainListResponse,
  type EventSummaryItem,
  type EventListResponse,
  type EventDetailResponse,
  type EventNodeImpact,
  type EventCompanyLanding,
  type CompanyProfileResponse,
  type ClaimItem,
  type EvidenceItem,
  type ExposureStrength,
  ChainListResponseSchema,
  ChainGraphResponseSchema,
  NodeDetailResponseSchema,
  EventListResponseSchema,
  EventDetailResponseSchema,
} from '../../src/contracts/index.js';
import { getSystemStatus } from './indicators.js';

// ---------------------------------------------------------------------------
// Load Tracked Verified Seed Bundle (Fail-Closed: Never Synthesize Evidence)
// ---------------------------------------------------------------------------
interface VerifiedMainbzSeedItem {
  item_name: string;
  mainop_type: 'product' | 'industry' | 'region';
  revenue_yuan: number | null;
  revenue_share: number | null;
  gross_margin: number | null;
  report_date: string;
  source_item_id: string;
}

interface VerifiedMainbzCompanySeed {
  report_period: string;
  source_url: string;
  observed_at: string;
  items: VerifiedMainbzSeedItem[];
}

interface RawSeedObservation {
  id: string;
  node_id: string;
  label: string;
  value: string;
  unit: string;
  date: string;
  source: string;
  evidence?: EvidenceItem[];
}

interface RawSeedBundle {
  schema_version: number;
  observed_at: string;
  nodes: Array<{
    id: string;
    name: string;
    aliases?: string[];
    root_ids?: string[];
    evidence: EvidenceItem[];
  }>;
  edges: Array<{
    id: string;
    from_id: string;
    to_id: string;
    kind: string;
    evidence: EvidenceItem[];
  }>;
  exposures: Array<{
    id: string;
    company_code: string;
    node_id: string;
    role: string;
    basis: string;
    status: string;
    evidence: EvidenceItem[];
  }>;
  observations?: RawSeedObservation[];
  news: Array<{
    id: string;
    title: string;
    summary?: string | null;
    url?: string | null;
    source?: string;
    published_at?: string | null;
    observed_at: string;
    verification?: string;
    node_ids?: string[];
    evidence: EvidenceItem[];
  }>;
  eastmoney_mainbz: Record<string, VerifiedMainbzCompanySeed>;
}

function loadVerifiedSeedBundle(): RawSeedBundle {
  const filePath = path.resolve(process.cwd(), 'server/content/verified-chain-seed.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `CRITICAL: Verified chain seed file missing at ${filePath}. Refusing to start with synthetic fallback data.`
    );
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RawSeedBundle;
  if (
    !parsed ||
    typeof parsed.observed_at !== 'string' ||
    !Array.isArray(parsed.nodes) ||
    parsed.nodes.length === 0 ||
    !Array.isArray(parsed.edges) ||
    parsed.edges.length === 0 ||
    !Array.isArray(parsed.exposures) ||
    !parsed.eastmoney_mainbz ||
    typeof parsed.eastmoney_mainbz !== 'object'
  ) {
    throw new Error(
      `CRITICAL: Verified chain seed file at ${filePath} is incomplete or corrupted. Refusing to start.`
    );
  }
  return parsed;
}

const SEED_BUNDLE = loadVerifiedSeedBundle();
const BUNDLE_OBSERVED_AT: string = SEED_BUNDLE.observed_at;
const SEED_NODE_MAP = new Map(SEED_BUNDLE.nodes.map(n => [n.id, n]));
const SEED_EDGE_LIST = SEED_BUNDLE.edges.filter(e => e.kind !== 'classification');
const SEED_EXPOSURE_MAP = new Map(
  SEED_BUNDLE.exposures.map(e => [`${e.company_code}:${e.node_id}`, e])
);
const SEED_OBSERVATIONS_BY_NODE = new Map<string, RawSeedObservation[]>();
for (const obs of SEED_BUNDLE.observations ?? []) {
  const list = SEED_OBSERVATIONS_BY_NODE.get(obs.node_id) ?? [];
  list.push(obs);
  SEED_OBSERVATIONS_BY_NODE.set(obs.node_id, list);
}

function getNodeEvidence(nodeId: string, nodeName: string): EvidenceItem[] {
  const seedNode = SEED_NODE_MAP.get(nodeId);
  if (seedNode && Array.isArray(seedNode.evidence) && seedNode.evidence.length > 0) {
    return seedNode.evidence.map(e => ({
      provider: String(e.provider),
      url: typeof e.url === 'string' ? e.url : null,
      title: String(e.title || `生产链节点 ${nodeName}`),
      observed_at: String(e.observed_at || BUNDLE_OBSERVED_AT),
      as_of: typeof e.as_of === 'string' ? e.as_of : null,
      verification:
        e.verification === 'primary'
          ? 'primary'
          : e.verification === 'provider'
            ? 'provider'
            : 'unverified',
      quote: e.quote,
      source_item_id: e.source_item_id,
    }));
  }
  return [
    {
      provider: 'manual_reviewed',
      url: null,
      title: `人工复核节点定义：${nodeName} (${nodeId})（未经上游 iFinD 节点表直接核实）`,
      observed_at: BUNDLE_OBSERVED_AT,
      as_of: null,
      verification: 'unverified',
    },
  ];
}

function getEdgeEvidence(
  fromId: string,
  toId: string,
  fromName: string,
  toName: string,
  defaultOrigin: 'ifind' | 'manual_reviewed'
): {
  id: string;
  origin: 'ifind' | 'manual_reviewed';
  evidence: EvidenceItem[];
} {
  const found = SEED_EDGE_LIST.find(e => e.from_id === fromId && e.to_id === toId);
  if (found && Array.isArray(found.evidence) && found.evidence.length > 0) {
    return {
      id: found.id,
      origin: 'ifind',
      evidence: found.evidence.map(ev => ({
        provider: String(ev.provider),
        url: typeof ev.url === 'string' ? ev.url : null,
        title: String(ev.title || `生产链有向边 ${fromName} -> ${toName}`),
        observed_at: String(ev.observed_at || BUNDLE_OBSERVED_AT),
        as_of: typeof ev.as_of === 'string' ? ev.as_of : null,
        verification:
          ev.verification === 'primary'
            ? 'primary'
            : ev.verification === 'provider'
              ? 'provider'
              : 'unverified',
        quote: ev.quote,
        source_item_id: ev.source_item_id,
      })),
    };
  }
  // Honest manual_reviewed fallback for cross-subtree supplemental edges not in iFinD edge table
  return {
    id: `manual:edge:${fromId}->${toId}`,
    origin: defaultOrigin === 'ifind' ? 'manual_reviewed' : defaultOrigin,
    evidence: [
      {
        provider: 'manual_reviewed',
        url: null,
        title: `人工复核产业上下游连接：${fromName} -> ${toName}（补充跨子树生产衔接，未经上游 iFinD 边表直接核实）`,
        observed_at: BUNDLE_OBSERVED_AT,
        as_of: null,
        verification: 'unverified',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 3 Institutional Core Industry Chains (Chain Membership Definition)
// ---------------------------------------------------------------------------
export const CHAIN_NODE_MEMBERSHIP: Record<string, string[]> = {
  lithium_energy: [
    'ifind:11294',
    'ifind:25722',
    'ifind:2972',
    'ifind:2992',
    'ifind:29054',
    'ifind:1899',
    'ifind:15778',
    'ifind:31771',
    'ifind:1879',
    'ifind:33405',
    'ifind:32081',
  ],
  optical_ai_compute: [
    'ifind:23976',
    'ifind:23979',
    'ifind:2899',
    'ifind:23992',
    'ifind:33176',
  ],
  semi_equip_material: [
    'ifind:11769',
    'ifind:26116',
    'ifind:2732',
    'ifind:2720',
    'ifind:2549',
    'ifind:2707',
    'ifind:2037',
    'ifind:2188',
    'ifind:2191',
    'ifind:2038',
  ],
};

// ---------------------------------------------------------------------------
// Verified Directed Edges (Using Real iFinD Edge IDs & Honest manual_reviewed Origin)
// Note: No classification edges like 光刻机 -> 半导体设备!
// ---------------------------------------------------------------------------
interface RawEdgeDef {
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  relation: 'input' | 'output' | 'equipment' | 'service';
  default_origin: 'ifind' | 'manual_reviewed';
}

const RAW_EDGE_DEFS: RawEdgeDef[] = [
  // Chain 1: lithium_energy
  { from_id: 'ifind:11294', from_name: '碳酸锂', to_id: 'ifind:2972', to_name: '锂电池正极材料', relation: 'input', default_origin: 'manual_reviewed' },
  { from_id: 'ifind:25722', from_name: '锂电池前驱体', to_id: 'ifind:2972', to_name: '锂电池正极材料', relation: 'input', default_origin: 'ifind' },
  { from_id: 'ifind:2972', from_name: '锂电池正极材料', to_id: 'ifind:29054', to_name: '锂电池电芯', relation: 'output', default_origin: 'ifind' },
  { from_id: 'ifind:2992', from_name: '锂离子电解液', to_id: 'ifind:1879', to_name: '锂离子电池', relation: 'output', default_origin: 'ifind' },
  { from_id: 'ifind:29054', from_name: '锂电池电芯', to_id: 'ifind:1899', to_name: '锂电池电芯模组', relation: 'input', default_origin: 'manual_reviewed' },
  { from_id: 'ifind:1899', from_name: '锂电池电芯模组', to_id: 'ifind:1879', to_name: '锂离子电池', relation: 'input', default_origin: 'ifind' },
  { from_id: 'ifind:15778', from_name: '电池热管理系统(EMS)', to_id: 'ifind:1879', to_name: '锂离子电池', relation: 'input', default_origin: 'ifind' },
  { from_id: 'ifind:31771', from_name: '电池管理系统(BMS)', to_id: 'ifind:1879', to_name: '锂离子电池', relation: 'input', default_origin: 'ifind' },
  { from_id: 'ifind:15778', from_name: '电池热管理系统(EMS)', to_id: 'ifind:33405', to_name: '储能系统集成', relation: 'input', default_origin: 'ifind' },
  { from_id: 'ifind:31771', from_name: '电池管理系统(BMS)', to_id: 'ifind:33405', to_name: '储能系统集成', relation: 'input', default_origin: 'ifind' },
  { from_id: 'ifind:1879', from_name: '锂离子电池', to_id: 'ifind:32081', to_name: '电动汽车', relation: 'output', default_origin: 'ifind' },
  { from_id: 'ifind:1879', from_name: '锂离子电池', to_id: 'ifind:33405', to_name: '储能系统集成', relation: 'output', default_origin: 'ifind' },

  // Chain 2: optical_ai_compute
  { from_id: 'ifind:23976', from_name: '光组件', to_id: 'ifind:23992', to_name: '光模块', relation: 'input', default_origin: 'ifind' },
  { from_id: 'ifind:23979', from_name: '光通信器件', to_id: 'ifind:23992', to_name: '光模块', relation: 'input', default_origin: 'ifind' },
  { from_id: 'ifind:2899', from_name: '印制电路板', to_id: 'ifind:23992', to_name: '光模块', relation: 'input', default_origin: 'manual_reviewed' },
  { from_id: 'ifind:23992', from_name: '光模块', to_id: 'ifind:33176', to_name: '光通信设备', relation: 'output', default_origin: 'ifind' },

  // Chain 3: semi_equip_material
  { from_id: 'ifind:11769', from_name: '石英坩埚', to_id: 'ifind:2549', to_name: '半导体材料', relation: 'input', default_origin: 'ifind' },
  { from_id: 'ifind:26116', from_name: '遮光膜', to_id: 'ifind:2549', to_name: '半导体材料', relation: 'input', default_origin: 'ifind' },
  { from_id: 'ifind:2732', from_name: '半导体单晶硅生长炉', to_id: 'ifind:2549', to_name: '半导体材料', relation: 'equipment', default_origin: 'ifind' },
  { from_id: 'ifind:2720', from_name: '光刻机', to_id: 'ifind:2549', to_name: '半导体材料', relation: 'equipment', default_origin: 'ifind' },
  { from_id: 'ifind:2549', from_name: '半导体材料', to_id: 'ifind:2188', to_name: '芯片代工', relation: 'output', default_origin: 'ifind' },
  { from_id: 'ifind:2549', from_name: '半导体材料', to_id: 'ifind:2191', to_name: '芯片封装测试', relation: 'output', default_origin: 'ifind' },
  { from_id: 'ifind:2549', from_name: '半导体材料', to_id: 'ifind:2038', to_name: '芯片', relation: 'output', default_origin: 'ifind' },
  { from_id: 'ifind:2707', from_name: '半导体设备', to_id: 'ifind:2037', to_name: '集成电路制造', relation: 'equipment', default_origin: 'manual_reviewed' },
  { from_id: 'ifind:2037', from_name: '集成电路制造', to_id: 'ifind:2188', to_name: '芯片代工', relation: 'service', default_origin: 'manual_reviewed' },
];

export const ALL_GRAPH_EDGES: ChainGraphEdge[] = RAW_EDGE_DEFS.map(def => {
  const evInfo = getEdgeEvidence(def.from_id, def.to_id, def.from_name, def.to_name, def.default_origin);
  return {
    id: evInfo.id,
    from_id: def.from_id,
    from_name: def.from_name,
    to_id: def.to_id,
    to_name: def.to_name,
    relation: def.relation,
    origin: evInfo.origin,
    evidence: evInfo.evidence,
  };
});

// ---------------------------------------------------------------------------
// Verified Mounted Company Exposures (Strictly Derived from Real eastmoney_mainbz)
// Note:
// - 002812.SZ (恩捷股份 - 隔膜) is NOT mounted on 锂电池电芯 (ifind:29054).
// - 000977.SZ (浪潮信息 - 服务器及部件) is NOT mounted on 光通信设备 (ifind:33176).
// - Zero hand-typed revenue_share, product_gross_margin, or report_period literals!
// ---------------------------------------------------------------------------
interface CompanyExposureSpec {
  exposure_id: string;
  company_code: string;
  company_name: string;
  node_id: string;
  node_name: string;
  role: string;
  matched_product_name: string;
}

const RAW_COMPANY_EXPOSURE_SPECS: CompanyExposureSpec[] = [
  {
    exposure_id: 'business:002466.SZ:11294',
    company_code: '002466.SZ',
    company_name: '天齐锂业',
    node_id: 'ifind:11294',
    node_name: '碳酸锂',
    role: '生产销售碳酸锂及锂化工产品',
    matched_product_name: '锂化合物及衍生品',
  },
  {
    exposure_id: 'business:300750.SZ:1879',
    company_code: '300750.SZ',
    company_name: '宁德时代',
    node_id: 'ifind:1879',
    node_name: '锂离子电池',
    role: '动力电池系统研发与制造',
    matched_product_name: '动力电池系统',
  },
  {
    exposure_id: 'business:300750.SZ:33405',
    company_code: '300750.SZ',
    company_name: '宁德时代',
    node_id: 'ifind:33405',
    node_name: '储能系统集成',
    role: '储能电池系统研发与集成',
    matched_product_name: '储能电池系统',
  },
  {
    exposure_id: 'business:300274.SZ:33405',
    company_code: '300274.SZ',
    company_name: '阳光电源',
    node_id: 'ifind:33405',
    node_name: '储能系统集成',
    role: '储能系统与变流器集成制造',
    matched_product_name: '储能系统',
  },
  {
    exposure_id: 'business:002594.SZ:32081',
    company_code: '002594.SZ',
    company_name: '比亚迪',
    node_id: 'ifind:32081',
    node_name: '电动汽车',
    role: '新能源汽车整车研发与制造',
    matched_product_name: '汽车、汽车相关产品及其他产品',
  },
  {
    exposure_id: 'business:300308.SZ:23992',
    company_code: '300308.SZ',
    company_name: '中际旭创',
    node_id: 'ifind:23992',
    node_name: '光模块',
    role: '高速光通信收发模块研发制造',
    matched_product_name: '光通信收发模块及器件',
  },
  {
    exposure_id: 'business:300502.SZ:23992',
    company_code: '300502.SZ',
    company_name: '新易盛',
    node_id: 'ifind:23992',
    node_name: '光模块',
    role: '高速光互联收发模块研发制造',
    matched_product_name: '光互联产品',
  },
  {
    exposure_id: 'business:300394.SZ:23979',
    company_code: '300394.SZ',
    company_name: '天孚通信',
    node_id: 'ifind:23979',
    node_name: '光通信器件',
    role: '光无源与光有源器件研发制造',
    matched_product_name: '光通信元器件',
  },
  {
    exposure_id: 'business:002371.SZ:2707',
    company_code: '002371.SZ',
    company_name: '北方华创',
    node_id: 'ifind:2707',
    node_name: '半导体设备',
    role: '刻蚀/薄膜沉积/清洗/炉管等电子工艺装备',
    matched_product_name: '电子工艺装备',
  },
  {
    exposure_id: 'business:688012.SH:2707',
    company_code: '688012.SH',
    company_name: '中微公司',
    node_id: 'ifind:2707',
    node_name: '半导体设备',
    role: '刻蚀设备、薄膜设备与MOCVD设备',
    matched_product_name: '半导体设备相关产品',
  },
  {
    exposure_id: 'business:688981.SH:2037',
    company_code: '688981.SH',
    company_name: '中芯国际',
    node_id: 'ifind:2037',
    node_name: '集成电路制造',
    role: '集成电路晶圆制造与配套服务',
    matched_product_name: '集成电路晶圆代工',
  },
  {
    exposure_id: 'business:688981.SH:2188',
    company_code: '688981.SH',
    company_name: '中芯国际',
    node_id: 'ifind:2188',
    node_name: '芯片代工',
    role: '集成电路晶圆代工',
    matched_product_name: '集成电路晶圆代工',
  },
];

function classifyExposureStrength(revenueShare: number | null): ExposureStrength {
  if (revenueShare === null) return 'verified_business';
  if (revenueShare >= 0.5) return 'primary_over_50';
  if (revenueShare >= 0.2) return 'major_20_to_50';
  return 'minor_under_20';
}

function buildVerifiedCompanyExposure(spec: CompanyExposureSpec): NodeCompanyExposure {
  const mainbzCompany = SEED_BUNDLE.eastmoney_mainbz[spec.company_code];
  if (!mainbzCompany || !Array.isArray(mainbzCompany.items)) {
    throw new Error(
      `CRITICAL: Missing eastmoney_mainbz seed record for ${spec.company_code} (${spec.company_name}).`
    );
  }

  // Prefer product breakdown item, then industry breakdown item with exact item_name match
  const matchedItem =
    mainbzCompany.items.find(
      it => it.mainop_type === 'product' && it.item_name === spec.matched_product_name
    ) ??
    mainbzCompany.items.find(it => it.item_name === spec.matched_product_name);

  if (!matchedItem) {
    throw new Error(
      `CRITICAL: Product "${spec.matched_product_name}" not found in eastmoney_mainbz for ${spec.company_code}.`
    );
  }

  const revenueShare = matchedItem.revenue_share;
  const productGrossMargin = matchedItem.gross_margin;
  const reportPeriod = matchedItem.report_date;
  const strength = classifyExposureStrength(revenueShare);

  const shareText = revenueShare !== null ? `营收占比 ${(revenueShare * 100).toFixed(2)}%` : '未拆分占比';
  const gmText =
    productGrossMargin !== null ? `，毛利率 ${(productGrossMargin * 100).toFixed(2)}%` : '';
  const basisText = `东财F10主营构成（报告期 ${reportPeriod}）列明【${matchedItem.item_name}】${shareText}${gmText}`;

  const seedExposure = SEED_EXPOSURE_MAP.get(`${spec.company_code}:${spec.node_id}`);
  const evidenceList: EvidenceItem[] = [];

  if (seedExposure && Array.isArray(seedExposure.evidence) && seedExposure.evidence.length > 0) {
    for (const ev of seedExposure.evidence) {
      evidenceList.push({
        provider: String(ev.provider),
        url: typeof ev.url === 'string' ? ev.url : null,
        title: String(ev.title || `${spec.company_code} 节点暴露核验`),
        observed_at: String(ev.observed_at || BUNDLE_OBSERVED_AT),
        as_of: typeof ev.as_of === 'string' ? ev.as_of : null,
        verification:
          ev.verification === 'primary'
            ? 'primary'
            : ev.verification === 'provider'
              ? 'provider'
              : 'unverified',
        quote: seedExposure.basis,
        source_item_id: ev.source_item_id,
      });
    }
  } else {
    // Explicitly mark manual node mounting when not in SEED_BUNDLE.exposures
    evidenceList.push({
      provider: 'manual_reviewed',
      url: null,
      title: `人工复核节点挂载：${spec.company_name} (${spec.company_code}) -> ${spec.node_name}（未经上游 iFinD 暴露表直接核实，依据东财F10主营分项匹配）`,
      observed_at: BUNDLE_OBSERVED_AT,
      as_of: reportPeriod,
      verification: 'unverified',
      quote: basisText,
    });
  }

  // Always attach the real EastMoney zygcfx product breakdown evidence item
  evidenceList.push({
    provider: 'eastmoney_mainbz',
    url: mainbzCompany.source_url,
    title: `${spec.company_code} 东方财富 F10 主营构成 (zygcfx) 报告期 ${reportPeriod}`,
    observed_at: mainbzCompany.observed_at,
    as_of: reportPeriod,
    verification: 'provider',
    quote: basisText,
    source_item_id: matchedItem.source_item_id,
  });

  return {
    exposure_id: spec.exposure_id,
    company_code: spec.company_code,
    company_name: spec.company_name,
    node_id: spec.node_id,
    node_name: spec.node_name,
    role: spec.role,
    basis_type: 'mainbz_revenue',
    basis_text: basisText,
    matched_product_name: matchedItem.item_name,
    revenue_share: revenueShare,
    product_gross_margin: productGrossMargin,
    report_period: reportPeriod,
    strength,
    evidence: evidenceList,
  };
}

export const ALL_COMPANY_EXPOSURES: NodeCompanyExposure[] = RAW_COMPANY_EXPOSURE_SPECS.map(
  buildVerifiedCompanyExposure
);

// ---------------------------------------------------------------------------
// Dynamic Node Margin Calculator (Real-time computed from member companies)
// ---------------------------------------------------------------------------
export function calculateNodeGrossMarginStats(nodeId: string): {
  sample_count: number;
  min_gross_margin: number | null;
  median_gross_margin: number | null;
  max_gross_margin: number | null;
  as_of_report_period: string | null;
} {
  const mounted = ALL_COMPANY_EXPOSURES.filter(
    e => e.node_id === nodeId && e.product_gross_margin !== null && e.strength !== 'candidate_only'
  );

  if (mounted.length === 0) {
    return {
      sample_count: 0,
      min_gross_margin: null,
      median_gross_margin: null,
      max_gross_margin: null,
      as_of_report_period: null,
    };
  }

  const margins = mounted.map(e => e.product_gross_margin as number).sort((a, b) => a - b);
  const minVal = margins[0];
  const maxVal = margins[margins.length - 1];
  const midIndex = Math.floor(margins.length / 2);
  const medianVal =
    margins.length % 2 === 0 ? (margins[midIndex - 1] + margins[midIndex]) / 2 : margins[midIndex];

  const periods = mounted
    .map(e => e.report_period)
    .filter((p): p is string => Boolean(p))
    .sort();

  return {
    sample_count: margins.length,
    min_gross_margin: Math.round(minVal * 10000) / 10000,
    median_gross_margin: Math.round(medianVal * 10000) / 10000,
    max_gross_margin: Math.round(maxVal * 10000) / 10000,
    as_of_report_period: periods.at(-1) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Build Graph Nodes Dynamically (All counts derived from actual edges/exposures)
// ---------------------------------------------------------------------------
interface RawNodeMeta {
  id: string;
  name: string;
  node_type: 'material' | 'equipment' | 'component' | 'product' | 'service' | 'application';
  aliases: string[];
  layer: number;
  pricing_mechanism: string;
  supply_constraints: string[];
}

const RAW_NODE_METADATA: Record<string, RawNodeMeta> = {
  // Chain 1: lithium_energy
  'ifind:11294': {
    id: 'ifind:11294',
    name: '碳酸锂',
    node_type: 'material',
    aliases: ['电池级碳酸锂', '工业级碳酸锂', '锂盐'],
    layer: 0,
    pricing_mechanism: '期货与现货指数联动定价（广期所碳酸锂主力合约 + SMM电池级现货均价长协折算）',
    supply_constraints: ['上游盐湖提锂季节性产率与锂辉石矿山品味波动', '高成本云母提锂产能出清阈值'],
  },
  'ifind:25722': {
    id: 'ifind:25722',
    name: '锂电池前驱体',
    node_type: 'material',
    aliases: ['三元前驱体', '磷酸铁前驱体', '前驱体'],
    layer: 0,
    pricing_mechanism: '金属盐原材料成本（镍钴锰/磷源）+ 加工费加成定价',
    supply_constraints: ['湿法冶炼环保审批周期', '下游正极材料大客户定制化粒径配方认证'],
  },
  'ifind:2972': {
    id: 'ifind:2972',
    name: '锂电池正极材料',
    node_type: 'material',
    aliases: ['磷酸铁锂', '三元正极', '正极材料', '锰铁锂'],
    layer: 0,
    pricing_mechanism: '碳酸锂及前驱体原材料联动公式 + 吨加工费定价，受存货周转周期影响显著',
    supply_constraints: ['高压实密度磷酸铁锂烧结工艺产能偏紧', '下游电芯厂供应链导入验证周期'],
  },
  'ifind:2992': {
    id: 'ifind:2992',
    name: '锂离子电解液',
    node_type: 'material',
    aliases: ['电解液', '六氟磷酸锂', 'LiPF6'],
    layer: 0,
    pricing_mechanism: '溶质六氟磷酸锂（LiPF6）及溶剂价格联动 + 配方复配加工费',
    supply_constraints: ['核心添加剂与六氟磷酸锂产能周期波动', '快充高电压新型锂盐（LiFSI）添加比例认证'],
  },
  'ifind:29054': {
    id: 'ifind:29054',
    name: '锂电池电芯',
    node_type: 'component',
    aliases: ['动力电芯', '储能电芯', '方形电芯'],
    layer: 1,
    pricing_mechanism: 'Wh 瓦时单价框架长协 + 碳酸锂价格阶梯联动调价机制',
    supply_constraints: ['大容量储能与超充电芯产线良率', '头部电芯厂高稼动率下的优质产能排期'],
  },
  'ifind:1899': {
    id: 'ifind:1899',
    name: '锂电池电芯模组',
    node_type: 'component',
    aliases: ['电池模组', 'CTP模组', '电芯模组'],
    layer: 1,
    pricing_mechanism: '电芯BOM成本传递 + 结构件与PACK集成加工附加值定价',
    supply_constraints: ['CTP/CTC无模组结构演进带来的产线改造需求', '定制化车规安全与热扩散测试要求'],
  },
  'ifind:15778': {
    id: 'ifind:15778',
    name: '电池热管理系统(EMS)',
    node_type: 'equipment',
    aliases: ['电池热管理', '储能液冷', '液冷温控'],
    layer: 1,
    pricing_mechanism: '按单GWh配套价值量招标定价（液冷系统单GWh价值量高于风冷）',
    supply_constraints: ['高能量密度储能柜对液冷均温性与密封寿命的严苛验证'],
  },
  'ifind:31771': {
    id: 'ifind:31771',
    name: '电池管理系统(BMS)',
    node_type: 'equipment',
    aliases: ['BMS', '电池管理系统'],
    layer: 1,
    pricing_mechanism: '硬件从控主控模块 + SOC/SOH算法软件授权按套定价',
    supply_constraints: ['车规级AFE模拟前端芯片供应链依赖', '大型储能电站主动均衡控制可靠性认证'],
  },
  'ifind:1879': {
    id: 'ifind:1879',
    name: '锂离子电池',
    node_type: 'product',
    aliases: ['动力电池', '锂电池', '锂电', '新型电池'],
    layer: 1,
    pricing_mechanism: '整车厂/储能业主年度定点框架协议 + 核心金属原材料价格联动机制',
    supply_constraints: ['车规与海外储能UL认证壁垒', '高端快充与长循环产线资本开支门槛'],
  },
  'ifind:33405': {
    id: 'ifind:33405',
    name: '储能系统集成',
    node_type: 'service',
    aliases: ['储能系统', '大型储能', '工商业储能', '独立储能', '储能招标'],
    layer: 2,
    pricing_mechanism: '电网/发电集团EPC或系统设备集采招标（元/Wh），海外市场享高毛利溢价',
    supply_constraints: ['海外并网构网型（Grid-forming）认证壁垒', '电芯与PCS交期协同及项目并网排期'],
  },
  'ifind:32081': {
    id: 'ifind:32081',
    name: '电动汽车',
    node_type: 'application',
    aliases: ['新能源汽车', '纯电动乘用车', '新能源整车'],
    layer: 2,
    pricing_mechanism: '终端消费市场车型指导价与促销折扣博弈，规模效应与垂直一体化决定单车盈利',
    supply_constraints: ['终端消费需求景气度与以旧换新政策节奏', '海外关税壁垒与本地化建厂进度'],
  },

  // Chain 2: optical_ai_compute
  'ifind:23976': {
    id: 'ifind:23976',
    name: '光组件',
    node_type: 'material',
    aliases: ['光无源器件', '陶瓷插芯', 'MT插芯', '光隔离器'],
    layer: 0,
    pricing_mechanism: '定制精密光学加工件按通道数与良率阶梯议价',
    supply_constraints: ['高密度MPO连接器与FAU光纤阵列精密耦合熟手技工及设备交期'],
  },
  'ifind:23979': {
    id: 'ifind:23979',
    name: '光通信器件',
    node_type: 'component',
    aliases: ['光引擎', '光器件', '光有源器件', '光芯片'],
    layer: 0,
    pricing_mechanism: '高速率光引擎与EML/硅光器件技术代际溢价，新速率导入初期毛利率高',
    supply_constraints: ['200G单通道EML激光器芯片与CW光源晶圆海外产能瓶颈'],
  },
  'ifind:2899': {
    id: 'ifind:2899',
    name: '印制电路板',
    node_type: 'material',
    aliases: ['PCB', '算力载板', '高速多层板', 'HDI板', '深南电路', '沪电股份'],
    layer: 0,
    pricing_mechanism: '按层数、高速覆铜板（CCL）等级与加工良率定制报价',
    supply_constraints: ['M7/M8级超低损耗覆铜板原材供应', '高多层HDI钻孔与电镀产能瓶颈'],
  },
  'ifind:23992': {
    id: 'ifind:23992',
    name: '光模块',
    node_type: 'product',
    aliases: ['高速光模块', '800G光模块', '1.6T光模块', '光收发模块', '光通信'],
    layer: 1,
    pricing_mechanism: '海外云厂商及国内算力客户季度/年度集采锁量议价，成熟速率按年阶梯降价，新速率享先发溢价',
    supply_constraints: ['上游高速光芯片（EML/DSP）配额供给', '海外头部CSP客户严苛的可靠性与互通性认证'],
  },
  'ifind:33176': {
    id: 'ifind:33176',
    name: '光通信设备',
    node_type: 'application',
    aliases: ['光传输设备', 'OTN设备', '数据中心光交换机', '波分复用设备'],
    layer: 2,
    pricing_mechanism: '运营商与云厂商集采招标及机架端口配套定价',
    supply_constraints: ['高速交换芯片与高端相干光模块配套供给', '骨干网与算力中心传输网建设资本开支节奏'],
  },

  // Chain 3: semi_equip_material
  'ifind:11769': {
    id: 'ifind:11769',
    name: '石英坩埚',
    node_type: 'material',
    aliases: ['高纯石英坩埚', '半导体石英坩埚'],
    layer: 0,
    pricing_mechanism: '内层高纯进口石英砂成本传导 + 耗材寿命周期议价',
    supply_constraints: ['高纯度半导体级内层石英砂矿源纯度与提纯工艺壁垒'],
  },
  'ifind:26116': {
    id: 'ifind:26116',
    name: '遮光膜',
    node_type: 'material',
    aliases: ['光学遮光膜', '半导体胶膜'],
    layer: 0,
    pricing_mechanism: '精密涂布配方与洁净度等级认证定价',
    supply_constraints: ['超薄光学基膜与无尘精密涂布良率'],
  },
  'ifind:2732': {
    id: 'ifind:2732',
    name: '半导体单晶硅生长炉',
    node_type: 'equipment',
    aliases: ['单晶炉', '12英寸长晶炉'],
    layer: 0,
    pricing_mechanism: '定制化单台套技术招标定价，按交付与终验节点分期确认收入',
    supply_constraints: ['超导磁场控制组件与高纯热场部件交期', '12英寸大硅片无缺陷晶体生长工艺验证'],
  },
  'ifind:2720': {
    id: 'ifind:2720',
    name: '光刻机',
    node_type: 'equipment',
    aliases: ['DUV光刻机', 'EUV光刻机', '微影设备'],
    layer: 0,
    pricing_mechanism: '极高技术垄断壁垒下的寡头议价（单台数千万至数亿欧元）',
    supply_constraints: ['双工件台、超精密物镜光学系统与极紫外光源跨国出口管制'],
  },
  'ifind:2549': {
    id: 'ifind:2549',
    name: '半导体材料',
    node_type: 'material',
    aliases: ['电子特气', '光刻胶', '大硅片', '湿电子化学品', 'CMP抛光材料', '靶材'],
    layer: 1,
    pricing_mechanism: '晶圆厂长协认证锁价，一旦导入产线轻易不更换供应商，具备高粘性耗材属性',
    supply_constraints: ['ppt级超高纯度纯化技术', '晶圆厂长达12–24个月的产线验证导入周期'],
  },
  'ifind:2707': {
    id: 'ifind:2707',
    name: '半导体设备',
    node_type: 'equipment',
    aliases: ['刻蚀机', '薄膜沉积设备', '清洗机', '混合键合设备', '半导体装备', 'CMP设备'],
    layer: 1,
    pricing_mechanism: '晶圆厂产线招标与首台套验证定价，定制化机台毛利率普遍在 40%–50% 区间',
    supply_constraints: ['射频电源、精密真空阀、静电卡盘等核心零部件海外出口管制与国产化进度'],
  },
  'ifind:2037': {
    id: 'ifind:2037',
    name: '集成电路制造',
    node_type: 'service',
    aliases: ['晶圆制造', '前道制造', 'Fab产线'],
    layer: 1,
    pricing_mechanism: '按晶圆尺寸（8英寸/12英寸）与制程节点（成熟/先进）结合产能稼动率阶梯定价',
    supply_constraints: ['先进制程光刻与刻蚀机台获取受限', '巨额折旧摊销下的高产能利用率要求'],
  },
  'ifind:2188': {
    id: 'ifind:2188',
    name: '芯片代工',
    node_type: 'service',
    aliases: ['晶圆代工', 'Foundry'],
    layer: 2,
    pricing_mechanism: '按晶圆片数（Wafer）与掩模层数报价，受全球半导体库存周期与稼动率驱动',
    supply_constraints: ['先进制程良率爬坡与资本开支折旧压力', '成熟制程价格竞争'],
  },
  'ifind:2191': {
    id: 'ifind:2191',
    name: '芯片封装测试',
    node_type: 'service',
    aliases: ['封测', '先进封装', 'CoWoS封装', 'Chiplet封装'],
    layer: 2,
    pricing_mechanism: '传统封测按引脚/颗数微利计价；2.5D/3D先进封装（CoWoS/混合键合）享显著技术溢价',
    supply_constraints: ['TSV硅通孔与中介层（Interposer）产能紧缺'],
  },
  'ifind:2038': {
    id: 'ifind:2038',
    name: '芯片',
    node_type: 'product',
    aliases: ['集成电路芯片', '算力芯片', 'SoC芯片', '存储芯片'],
    layer: 2,
    pricing_mechanism: 'Fabless设计性能溢价或存储周期现货/合约价联动',
    supply_constraints: ['先进代工产能与CoWoS封装配额约束', '下游终端消费电子与AI服务器需求周期'],
  },
};

export const ALL_GRAPH_NODES: Record<string, ChainGraphNode> = Object.fromEntries(
  Object.values(RAW_NODE_METADATA).map(meta => {
    const seedNode = SEED_NODE_MAP.get(meta.id);
    const mergedAliases = Array.from(new Set([...(seedNode?.aliases || []), ...meta.aliases]));
    const upstreamCount = ALL_GRAPH_EDGES.filter(e => e.to_id === meta.id).length;
    const downstreamCount = ALL_GRAPH_EDGES.filter(e => e.from_id === meta.id).length;
    const verifiedCompanyCount = new Set(
      ALL_COMPANY_EXPOSURES.filter(e => e.node_id === meta.id && e.strength !== 'candidate_only').map(
        e => e.company_code
      )
    ).size;
    const marginStats = calculateNodeGrossMarginStats(meta.id);

    const node: ChainGraphNode = {
      id: meta.id,
      name: seedNode?.name || meta.name,
      node_type: meta.node_type,
      origin: SEED_NODE_MAP.has(meta.id) ? 'ifind' : 'manual_reviewed',
      aliases: mergedAliases,
      layer: meta.layer,
      upstream_count: upstreamCount,
      downstream_count: downstreamCount,
      verified_company_count: verifiedCompanyCount,
      computed_median_margin: marginStats.median_gross_margin,
      evidence: getNodeEvidence(meta.id, meta.name),
    };
    return [meta.id, node];
  })
);

function buildDynamicChainSummaries(mappedEventCountsByChain: Record<string, number> = {}): ChainSummary[] {
  const defs = [
    {
      id: 'lithium_energy',
      name: '锂电与储能产业链',
      root_node_id: 'ifind:1879',
      description: '涵盖上游碳酸锂与正极前驱体、中游电芯模组与BMS/EMS热管理、下游储能系统集成与电动汽车。',
    },
    {
      id: 'optical_ai_compute',
      name: 'AI 算力与光模块产业链',
      root_node_id: 'ifind:23992',
      description: '涵盖上游光组件、光通信器件与PCB、中游高速光模块、下游光通信设备。',
    },
    {
      id: 'semi_equip_material',
      name: '半导体设备与材料产业链',
      root_node_id: 'ifind:2707',
      description: '涵盖上游石英坩埚/生长炉/光刻设备、中游半导体材料与半导体设备、下游晶圆制造代工与封装测试。',
    },
  ];

  return defs.map(d => {
    const nodeIds = CHAIN_NODE_MEMBERSHIP[d.id] || [];
    const edges = ALL_GRAPH_EDGES.filter(e => nodeIds.includes(e.from_id) && nodeIds.includes(e.to_id));
    const uniqueCompanies = new Set(
      ALL_COMPANY_EXPOSURES.filter(e => nodeIds.includes(e.node_id) && e.strength !== 'candidate_only').map(
        e => e.company_code
      )
    );
    return {
      id: d.id,
      name: d.name,
      root_node_id: d.root_node_id,
      description: d.description,
      node_count: nodeIds.length,
      edge_count: edges.length,
      company_count: uniqueCompanies.size,
      recent_event_count: mappedEventCountsByChain[d.id] ?? 0,
    };
  });
}

export const CORE_CHAIN_SUMMARIES: ChainSummary[] = buildDynamicChainSummaries();

// ---------------------------------------------------------------------------
// Chain Graph API Handlers
// ---------------------------------------------------------------------------
export async function listChains(pool?: Pool): Promise<ChainListResponse> {
  const rawEvents = await loadRawEventsFromDb(pool);
  const counts: Record<string, number> = {
    lithium_energy: 0,
    optical_ai_compute: 0,
    semi_equip_material: 0,
  };
  for (const raw of rawEvents) {
    const detail = buildEventDetailFromRaw(raw);
    if (
      detail.event.coverage_status === 'mapped' &&
      detail.event.matched_chain_id &&
      counts[detail.event.matched_chain_id] !== undefined
    ) {
      counts[detail.event.matched_chain_id]++;
    }
  }
  return ChainListResponseSchema.parse({
    chains: buildDynamicChainSummaries(counts),
  });
}

export async function getChainGraph(chainId: string, pool?: Pool): Promise<ChainGraphResponse> {
  const summaries = (await listChains(pool)).chains;
  const chain = summaries.find(c => c.id === chainId);
  if (!chain) {
    throw new ApiError(404, 'NOT_FOUND', `未找到产业链 ID: ${chainId}。系统仅提供已建库核验的 3 条核心产业链。`);
  }

  const nodeIds = CHAIN_NODE_MEMBERSHIP[chainId] || [];
  const nodes = nodeIds.map(id => {
    const raw = ALL_GRAPH_NODES[id];
    const marginStats = calculateNodeGrossMarginStats(id);
    const upCount = ALL_GRAPH_EDGES.filter(e => e.to_id === id && nodeIds.includes(e.from_id)).length;
    const downCount = ALL_GRAPH_EDGES.filter(e => e.from_id === id && nodeIds.includes(e.to_id)).length;
    return {
      ...raw,
      upstream_count: upCount,
      downstream_count: downCount,
      computed_median_margin: marginStats.median_gross_margin,
    };
  });

  const edges = ALL_GRAPH_EDGES.filter(e => nodeIds.includes(e.from_id) && nodeIds.includes(e.to_id));
  const exposures = ALL_COMPANY_EXPOSURES.filter(e => nodeIds.includes(e.node_id));

  return ChainGraphResponseSchema.parse({
    chain,
    nodes,
    edges,
    exposures,
  });
}

export async function getNodeDetail(nodeId: string, pool?: Pool): Promise<NodeDetailResponse> {
  const node = ALL_GRAPH_NODES[nodeId];
  if (!node) {
    throw new ApiError(404, 'NOT_FOUND', `未找到产业链节点 ID: ${nodeId}`);
  }

  const meta = RAW_NODE_METADATA[nodeId];
  const marginStats = calculateNodeGrossMarginStats(nodeId);
  const upstream = ALL_GRAPH_EDGES.filter(e => e.to_id === nodeId);
  const downstream = ALL_GRAPH_EDGES.filter(e => e.from_id === nodeId);
  const companies = ALL_COMPANY_EXPOSURES.filter(e => e.node_id === nodeId);

  let trackedObservations: NodeLogicCard['tracked_observations'] = [];
  if (pool && typeof pool.query === 'function') {
    const obsRes = await pool.query<{
      body: { id: string; label: string; value: string; unit: string; date: string; source: string };
    }>(`SELECT body FROM content_observations WHERE node_id = $1 ORDER BY date DESC LIMIT 20`, [nodeId]);
    trackedObservations = obsRes.rows.map(r => ({
      id: String(r.body.id),
      label: String(r.body.label),
      value: String(r.body.value),
      unit: String(r.body.unit),
      date: String(r.body.date),
      source: String(r.body.source),
    }));
  } else {
    const seedObs = SEED_OBSERVATIONS_BY_NODE.get(nodeId) ?? [];
    trackedObservations = seedObs.map(o => ({
      id: o.id,
      label: o.label,
      value: o.value,
      unit: o.unit,
      date: o.date,
      source: o.source,
    }));
  }

  const logicCard: NodeLogicCard = {
    node_id: nodeId,
    node_name: node.name,
    node_type: node.node_type,
    pricing_mechanism: meta?.pricing_mechanism || '按上下游框架长协与现货供需议价定价',
    key_cost_inputs:
      upstream.length > 0 ? upstream.map(u => u.from_name) : ['上游直接节点未在当前子图展开'],
    demand_drivers:
      downstream.length > 0 ? downstream.map(d => d.to_name) : ['终端应用节点未在当前子图展开'],
    supply_constraints: meta?.supply_constraints || ['核心工艺良率与产能爬坡周期'],
    computed_margin_stats: marginStats,
    tracked_observations: trackedObservations,
    citations: node.evidence,
  };

  const rawEvents = await loadRawEventsFromDb(pool);
  const recentEvents: NodeDetailResponse['recent_events'] = [];
  for (const raw of rawEvents) {
    const detail = buildEventDetailFromRaw(raw);
    const hit = detail.impacts.find(imp => imp.node_id === nodeId);
    if (hit) {
      recentEvents.push({
        event_id: detail.event.event_id,
        headline: detail.event.headline,
        published_at: detail.event.published_at,
        hop: hit.hop,
        direction: hit.direction,
        mechanism: hit.mechanism,
      });
    }
    if (recentEvents.length >= 10) break;
  }

  return NodeDetailResponseSchema.parse({
    node: {
      ...node,
      computed_median_margin: marginStats.median_gross_margin,
    },
    logic_card: logicCard,
    upstream,
    downstream,
    companies,
    recent_events: recentEvents,
  });
}

// ---------------------------------------------------------------------------
// Closed-Set Event Pipeline & Graph-Constrained Transmission (P4)
// ---------------------------------------------------------------------------
export interface RawInputEvent {
  id: string;
  version: number;
  headline: string;
  summary: string | null;
  published_at: string | null;
  observed_at: string;
  source_name: string;
  source_url: string | null;
  evidence_status: 'primary_supported' | 'corroborated' | 'unverified';
  explicit_node_ids: string[];
  claims: ClaimItem[];
}

const IN_MEMORY_CUSTOM_EVENTS = new Map<string, RawInputEvent>();

function deriveHonestEvidenceStatus(
  rawVerification: string | undefined,
  evs: EvidenceItem[]
): 'primary_supported' | 'corroborated' | 'unverified' {
  if (rawVerification === 'primary' || evs.some(e => e.verification === 'primary')) {
    return 'primary_supported';
  }
  const distinctProviders = new Set(evs.map(e => e.provider).filter(Boolean));
  if (rawVerification === 'corroborated' || distinctProviders.size >= 2) {
    return 'corroborated';
  }
  return 'unverified';
}

export const OFFLINE_TEST_EVENTS: RawInputEvent[] = (SEED_BUNDLE.news ?? []).map(n => {
  const evs: EvidenceItem[] =
    Array.isArray(n.evidence) && n.evidence.length > 0
      ? n.evidence.map(e => ({
          provider: String(e.provider || n.source || 'hexin-ifind-ds-mcp'),
          url: typeof e.url === 'string' ? e.url : (n.url ?? null),
          title: String(e.title || n.title),
          observed_at: String(e.observed_at || n.observed_at || BUNDLE_OBSERVED_AT),
          as_of: typeof e.as_of === 'string' ? e.as_of : (n.published_at ?? null),
          verification:
            e.verification === 'primary'
              ? 'primary'
              : e.verification === 'provider'
                ? 'provider'
                : 'unverified',
          quote: e.quote,
          source_item_id: e.source_item_id,
        }))
      : [
          {
            provider: String(n.source || 'hexin-ifind-ds-mcp'),
            url: n.url ?? null,
            title: n.title,
            observed_at: n.observed_at || BUNDLE_OBSERVED_AT,
            as_of: n.published_at ?? null,
            verification: 'provider',
          },
        ];

  const evStatus = deriveHonestEvidenceStatus(n.verification, evs);
  return {
    id: n.id,
    version: 1,
    headline: n.title,
    summary: n.summary ?? null,
    published_at: n.published_at ?? null,
    observed_at: n.observed_at || BUNDLE_OBSERVED_AT,
    source_name: String(n.source || '行业快讯'),
    source_url: n.url ?? null,
    evidence_status: evStatus,
    explicit_node_ids: Array.isArray(n.node_ids) ? n.node_ids : [],
    claims: [
      {
        claim_id: `${n.id}_c1`,
        text: n.summary ? `${n.title}：${n.summary}` : n.title,
        kind: evStatus === 'primary_supported' || evStatus === 'corroborated' ? 'fact' : 'source_opinion',
        evidence_status: evStatus,
        evidence: evs,
      },
    ],
  };
});

function extractTextBigrams(text: string): Set<string> {
  const cleaned = text
    .replace(/[\s，。！？：；、“”‘’（）()【】《》、,.!?:;\-—_]/g, '')
    .replace(/关于|股份有限公司|有限公司|董事会|第[一二三四五六七八九十\d]+届|第[一二三四五六七八九十\d]+次|会议/g, '')
    .toLowerCase();
  const grams = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i++) {
    grams.add(cleaned.slice(i, i + 2));
  }
  return grams;
}

function isNearDuplicateEventText(candidateText: string, seenTexts: string[]): boolean {
  const candGrams = extractTextBigrams(candidateText);
  if (candGrams.size === 0) return false;
  for (const prev of seenTexts) {
    const prevGrams = extractTextBigrams(prev);
    if (prevGrams.size === 0) continue;
    let intersection = 0;
    for (const g of candGrams) {
      if (prevGrams.has(g)) intersection++;
    }
    const minSize = Math.min(candGrams.size, prevGrams.size);
    if (minSize > 0 && intersection / minSize >= 0.55) {
      return true;
    }
    // Same leading 4-char entity subject + both are board resolution / M&A announcements
    const cClean = candidateText.replace(/\s+/g, '');
    const pClean = prev.replace(/\s+/g, '');
    if (
      cClean.length >= 4 &&
      pClean.length >= 4 &&
      cClean.slice(0, 4) === pClean.slice(0, 4) &&
      intersection >= 4
    ) {
      return true;
    }
  }
  return false;
}

async function loadRawEventsFromDb(pool?: Pool): Promise<RawInputEvent[]> {
  // Offline unit-test mode (no pool provided): use verified seed news
  if (!pool || typeof pool.query !== 'function') {
    return [...OFFLINE_TEST_EVENTS];
  }

  // Database mode: NEVER fall back to OFFLINE_TEST_EVENTS on empty DB or DB error
  const results: RawInputEvent[] = [];
  const seenTexts: string[] = [];
  const clusteredSourceItemIds = new Set<string>();

  // 1. Load verified editorial events from content_editorial_events
  const edRes = await pool.query<{
    id: string;
    version: number;
    body: any;
    sources: any[];
    published_at: Date;
  }>(`
    SELECT e.id, v.version, v.body, v.sources, v.published_at
    FROM content_editorial_events e
    JOIN content_editorial_versions v ON v.event_id = e.id AND v.version = e.current_version
    ORDER BY v.published_at DESC
    LIMIT 20
  `);

  for (const row of edRes.rows) {
    const draft = row.body ?? {};
    const sources = Array.isArray(row.sources) ? row.sources : [];
    for (const s of sources) {
      if (typeof s?.item_id === 'string') clusteredSourceItemIds.add(s.item_id);
      if (typeof s?.id === 'string') clusteredSourceItemIds.add(s.id);
    }

    const headline = String(draft.headline || '已核验事件');
    const summaryText = typeof draft.change?.text === 'string' ? draft.change.text : '';
    if (isNearDuplicateEventText(`${headline} ${summaryText}`, seenTexts)) continue;
    seenTexts.push(`${headline} ${summaryText}`);

    const newsSources = sources.filter(s => Array.isArray(s.roles) && s.roles.includes('news'));
    const pubDates = newsSources.map(s => s.published_at).filter((d): d is string => Boolean(d)).sort();
    const firstDiscovered = newsSources.map(s => s.discovered_at).filter((d): d is string => Boolean(d)).sort()[0];
    const primarySource = newsSources[0] ?? sources[0] ?? {};

    const mappedEvidence: EvidenceItem[] = sources.slice(0, 4).map(s => ({
      provider: String(s.provider || '同花顺 iFinD MCP'),
      url: typeof s.url === 'string' && s.url.startsWith('http') ? s.url : null,
      title: String(s.title || headline),
      observed_at: String(s.discovered_at || row.published_at.toISOString()),
      as_of: typeof s.published_at === 'string' ? s.published_at : null,
      verification: s.primary ? ('primary' as const) : ('provider' as const),
      quote: typeof draft.change?.citations?.[0]?.quote === 'string' ? draft.change.citations[0].quote : undefined,
      source_item_id: typeof s.item_id === 'string' ? s.item_id : undefined,
    }));

    const fallbackEv: EvidenceItem = {
      provider: String(primarySource.provider || 'content_editorial_events'),
      url: null,
      title: headline,
      observed_at: row.published_at.toISOString(),
      as_of: null,
      verification: 'provider',
    };

    const evList = mappedEvidence.length > 0 ? mappedEvidence : [fallbackEv];
    const hasPrimary = newsSources.some(s => s.primary);
    const evStatus: RawInputEvent['evidence_status'] = hasPrimary
      ? 'primary_supported'
      : newsSources.length >= 2
        ? 'corroborated'
        : 'unverified';

    const claims: ClaimItem[] = [];
    if (draft.change?.text) {
      claims.push({
        claim_id: `${row.id}_change`,
        text: String(draft.change.text),
        kind: hasPrimary ? 'fact' : 'source_opinion',
        evidence_status: evStatus,
        evidence: evList,
      });
    }
    if (Array.isArray(draft.facts)) {
      draft.facts.forEach((f: any, idx: number) => {
        if (f?.text) {
          claims.push({
            claim_id: `${row.id}_fact_${idx + 1}`,
            text: String(f.text),
            kind: hasPrimary ? 'fact' : 'source_opinion',
            evidence_status: evStatus,
            evidence: evList,
          });
        }
      });
    }
    if (draft.why?.text) {
      claims.push({
        claim_id: `${row.id}_why`,
        text: String(draft.why.text),
        kind: 'conditional_inference',
        evidence_status: evStatus,
        evidence: evList,
      });
    }

    results.push({
      id: row.id,
      version: Number(row.version || 1),
      headline,
      summary: typeof draft.change?.text === 'string' ? draft.change.text : null,
      published_at:
        pubDates.at(-1) ??
        (typeof draft.group?.occurred_on === 'string' ? `${draft.group.occurred_on}T00:00:00.000Z` : null),
      observed_at: firstDiscovered ?? row.published_at.toISOString(),
      source_name: String(primarySource.provider || '已核验公告/资讯源'),
      source_url: typeof primarySource.url === 'string' && primarySource.url.startsWith('http') ? primarySource.url : null,
      evidence_status: evStatus,
      explicit_node_ids: [],
      claims:
        claims.length > 0
          ? claims
          : [
              {
                claim_id: `${row.id}_clm_1`,
                text: headline,
                kind: hasPrimary ? 'fact' : 'source_opinion',
                evidence_status: evStatus,
                evidence: evList,
              },
            ],
    });
  }

  // 2. Load real news items from content_news, skipping items already clustered into editorial events
  const newsRes = await pool.query<{
    id: string;
    published_at: Date | null;
    observed_at: Date;
    body: any;
  }>(`
    SELECT id, published_at, observed_at, body
    FROM content_news
    ORDER BY published_at DESC NULLS LAST, observed_at DESC
    LIMIT 45
  `);

  for (const row of newsRes.rows) {
    if (clusteredSourceItemIds.has(row.id)) continue;
    const b = row.body ?? {};
    const headline = String(b.title || row.id);
    const summaryText = typeof b.summary === 'string' ? b.summary : '';
    if (isNearDuplicateEventText(`${headline} ${summaryText}`, seenTexts)) continue;
    seenTexts.push(`${headline} ${summaryText}`);

    const evList: EvidenceItem[] = Array.isArray(b.evidence)
      ? b.evidence.map((e: any) => ({
          provider: String(e.provider || b.source || '数据源'),
          url: typeof e.url === 'string' && e.url.startsWith('http') ? e.url : null,
          title: String(e.title || headline),
          observed_at: String(e.observed_at || row.observed_at.toISOString()),
          as_of: typeof e.as_of === 'string' ? e.as_of : null,
          verification:
            e.verification === 'primary'
              ? ('primary' as const)
              : e.verification === 'provider'
                ? ('provider' as const)
                : ('unverified' as const),
          quote: typeof e.quote === 'string' ? e.quote : undefined,
          source_item_id: typeof e.source_item_id === 'string' ? e.source_item_id : row.id,
        }))
      : [
          {
            provider: String(b.source || 'content_news'),
            url: typeof b.url === 'string' && b.url.startsWith('http') ? b.url : null,
            title: headline,
            observed_at: row.observed_at.toISOString(),
            as_of: row.published_at ? row.published_at.toISOString() : null,
            verification: 'provider',
          },
        ];

    const verStatus = deriveHonestEvidenceStatus(b.verification, evList);

    results.push({
      id: row.id,
      version: 1,
      headline,
      summary: typeof b.summary === 'string' ? b.summary : null,
      published_at: row.published_at ? row.published_at.toISOString() : null,
      observed_at: row.observed_at.toISOString(),
      source_name: String(b.source || evList[0]?.provider || '资讯源'),
      source_url: typeof b.url === 'string' && b.url.startsWith('http') ? b.url : null,
      evidence_status: verStatus,
      explicit_node_ids: Array.isArray(b.node_ids) ? b.node_ids.map(String) : [],
      claims: [
        {
          claim_id: `clm_${createHash('sha256').update(row.id).digest('hex').slice(0, 10)}`,
          text: String(b.summary || headline),
          kind: verStatus === 'primary_supported' || verStatus === 'corroborated' ? 'fact' : 'source_opinion',
          evidence_status: verStatus,
          evidence: evList,
        },
      ],
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Polarity & Shock Variable Detector + Closed-Set Alias Node Matcher
// ---------------------------------------------------------------------------
export type ShockPolarity = 'positive' | 'negative' | 'ambiguous';

export function isRumorDenialText(text: string): boolean {
  return /否认.*传闻|否认停产|辟谣|澄清.*传闻|传闻不实|不属实|生产经营.*正常/.test(text);
}

export function isCapitalOrSingleCorpActionText(text: string): {
  isCapitalOnly: boolean;
  isSingleCompanyMna: boolean;
} {
  const isCapitalOnly = /提议回购|回购.*股份|发行h股|h股.*备案|港股上市|募集说明书|股东减持|解除质押/i.test(text);
  const isSingleCompanyMna = /拟收购|收购.*股权|并购|切入.*供应链/.test(text);
  return { isCapitalOnly, isSingleCompanyMna };
}

export function detectShockAndPolarity(text: string): {
  shock: 'selling_price' | 'input_cost' | 'demand' | 'orders' | 'supply' | 'capacity' | 'policy';
  polarity: ShockPolarity;
} {
  const t = text.toLowerCase();

  const negPattern =
    /暴跌|大跌|下跌|走低|跌破|跳水|下调|削减|砍单|不及预期|创新低|新低|停产|火灾|爆炸|安全事故|制裁|实体清单|限制.*出口|出口管制|收紧.*管制|禁令|亏损|预亏|暴雷|违约|产能过剩|库存高企|积压|萎缩|下滑|承压|受阻|减产/;
  const posPattern =
    /暴涨|大涨|上涨|提价|涨价|上调|追加|扩产|突破|中标|收购|并购|切入|预增|大增|高增|翻倍|预喜|满产|排期|高景气|放量|投产/;

  const hasNeg = negPattern.test(t);
  const hasPos = posPattern.test(t);

  let polarity: ShockPolarity = 'ambiguous';
  if (hasNeg && !hasPos) {
    polarity = 'negative';
  } else if (hasPos && !hasNeg) {
    polarity = 'positive';
  } else if (hasNeg && hasPos) {
    polarity = 'ambiguous';
  }

  let shock: 'selling_price' | 'input_cost' | 'demand' | 'orders' | 'supply' | 'capacity' | 'policy' = 'demand';
  if (/规划|政策|工信部|指导意见|补贴|准入/.test(t)) {
    shock = 'policy';
    if (!hasNeg && !hasPos) polarity = 'ambiguous';
  } else if (/价格|现货|报价|暴跌|暴涨|涨价|跌价|走低|跌破|创新低|新低|库存高企/.test(t)) {
    shock = 'selling_price';
  } else if (/火灾|停产|事故|产能|投产|扩产|满产|拟收购|收购|并购|切入/.test(t)) {
    shock = 'capacity';
  } else if (/实体清单|制裁|限制.*出口|出口管制|收紧.*管制|断供|短缺/.test(t)) {
    shock = 'supply';
  } else if (/采购|订单|中标|砍单|削减|排期|预增|预喜/.test(t)) {
    shock = 'orders';
  }

  return { shock, polarity };
}

function getChainIdForNode(nodeId: string): string | null {
  for (const [chainId, nodeIds] of Object.entries(CHAIN_NODE_MEMBERSHIP)) {
    if (nodeIds.includes(nodeId)) return chainId;
  }
  return null;
}

export function matchClosedSetNode(
  text: string,
  explicitNodeIds: string[] = []
): {
  chainId: string;
  nodeId: string;
  shock: 'selling_price' | 'input_cost' | 'demand' | 'orders' | 'supply' | 'capacity' | 'policy';
  polarity: ShockPolarity;
} | null {
  const t = text.toLowerCase();
  const { shock, polarity } = detectShockAndPolarity(text);

  // 1. Exact node name or alias match across all 26 modeled nodes (ordered from specific to general)
  const orderedNodeIds = [
    // Chain 2 (Optical AI - check before general chip/semi)
    'ifind:23992', // 光模块
    'ifind:23979', // 光通信器件 / 光芯片 / 光引擎
    'ifind:23976', // 光组件
    'ifind:2899',  // 印制电路板 / PCB / 算力载板
    'ifind:33176', // 光通信设备
    // Chain 1 (Lithium & Energy Storage)
    'ifind:11294', // 碳酸锂
    'ifind:25722', // 锂电池前驱体
    'ifind:2972',  // 锂电池正极材料
    'ifind:2992',  // 锂离子电解液
    'ifind:15778', // 电池热管理系统(EMS)
    'ifind:31771', // 电池管理系统(BMS)
    'ifind:1899',  // 锂电池电芯模组
    'ifind:29054', // 锂电池电芯
    'ifind:33405', // 储能系统集成
    'ifind:32081', // 电动汽车
    'ifind:1879',  // 锂离子电池
    // Chain 3 (Semiconductor Equipment & Materials)
    'ifind:11769', // 石英坩埚
    'ifind:26116', // 遮光膜
    'ifind:2732',  // 半导体单晶硅生长炉
    'ifind:2720',  // 光刻机
    'ifind:2707',  // 半导体设备 (刻蚀机/薄膜沉积/混合键合)
    'ifind:2549',  // 半导体材料 (电子特气/光刻胶/大硅片)
    'ifind:2188',  // 芯片代工
    'ifind:2191',  // 芯片封装测试
    'ifind:2037',  // 集成电路制造
    'ifind:2038',  // 芯片
  ];

  for (const nodeId of orderedNodeIds) {
    const node = ALL_GRAPH_NODES[nodeId];
    if (!node) continue;
    const candidates = [node.name, ...node.aliases].map(s => s.toLowerCase()).filter(s => s.length >= 2);
    if (nodeId === 'ifind:2038') {
      if (t.includes('算力芯片') || t.includes('存储芯片') || t.includes('soc芯片')) {
        return { chainId: 'semi_equip_material', nodeId, shock, polarity };
      }
      continue;
    }
    if (candidates.some(kw => t.includes(kw))) {
      const chainId = getChainIdForNode(nodeId);
      if (chainId) {
        return { chainId, nodeId, shock, polarity };
      }
    }
  }

  // 2. Check mounted company primary exposure when company faces a direct operational/order/sanction event
  for (const exp of ALL_COMPANY_EXPOSURES) {
    if (exp.strength === 'primary_over_50') {
      const compNameLower = exp.company_name.toLowerCase();
      const codePrefix = exp.company_code.slice(0, 6);
      if (t.includes(compNameLower) || t.includes(codePrefix)) {
        const chainId = getChainIdForNode(exp.node_id);
        if (chainId) {
          return { chainId, nodeId: exp.node_id, shock, polarity };
        }
      }
    }
  }

  // 3. Check explicit_node_ids from DB
  const prioritizedExplicit = [...explicitNodeIds].sort((a, b) => {
    const idxA = orderedNodeIds.indexOf(a);
    const idxB = orderedNodeIds.indexOf(b);
    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
  });
  for (const nid of prioritizedExplicit) {
    const chainId = getChainIdForNode(nid);
    if (chainId && ALL_GRAPH_NODES[nid]) {
      return { chainId, nodeId: nid, shock, polarity };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Direction Prior Table with Explicit Polarity & Corporate-Action Awareness
// ---------------------------------------------------------------------------
function computeEpicenterDirection(
  shock: 'selling_price' | 'input_cost' | 'demand' | 'orders' | 'supply' | 'capacity' | 'policy',
  polarity: ShockPolarity,
  nodeName: string,
  corpFlags: { isCapitalOnly: boolean; isSingleCompanyMna: boolean }
): {
  direction: 'favorable' | 'unfavorable' | 'uncertain';
  direction_label: string;
  mechanism: string;
} {
  if (corpFlags.isCapitalOnly) {
    return {
      direction: 'uncertain',
      direction_label: '不确定（属公司股份回购或资本市场融资备案，不直接改变当期产业供需）',
      mechanism: `事件涉及【${nodeName}】环节代表性公司的股份回购或融资备案，属企业资本结构层面事项，不构成直接的上下游价格或订单冲击。`,
    };
  }

  if (shock === 'policy' || polarity === 'ambiguous') {
    return {
      direction: 'uncertain',
      direction_label: '不确定（需视政策细则落地或实际供需订单方向验证）',
      mechanism: `事件涉及【${nodeName}】环节，但缺乏单一明确的正负向订单或价格冲击证据，按审慎原则标为不确定。`,
    };
  }

  if (polarity === 'negative') {
    if (shock === 'selling_price') {
      return {
        direction: 'unfavorable',
        direction_label: '偏负面（产品价格下跌与去库压力挤压毛利）',
        mechanism: `【${nodeName}】现货或合约价格明显下跌，直接压缩本环节生产商单位售价与毛利率，且高价库存面临跌价计提压力。`,
      };
    }
    if (shock === 'capacity' || shock === 'supply') {
      return {
        direction: 'unfavorable',
        direction_label: '偏负面（产线停产事故或供应链受限冲击交付）',
        mechanism: `【${nodeName}】遭遇产线停产、安全事故或外部供应链出口管制，直接阻碍正常排产交付并增加合规及替代成本。`,
      };
    }
    return {
      direction: 'unfavorable',
      direction_label: '偏负面（下游需求或采购订单削减）',
      mechanism: `【${nodeName}】面临下游客户削减采购或需求不及预期，产能利用率与出货量预期下修。`,
    };
  }

  // polarity === 'positive'
  if (shock === 'selling_price') {
    return {
      direction: 'favorable',
      direction_label: '偏正面（产品提价改善本环节单位盈利）',
      mechanism: `【${nodeName}】产品价格上行，在成本端相对刚性条件下直接增厚本环节单位毛利。`,
    };
  }
  if (corpFlags.isSingleCompanyMna) {
    return {
      direction: 'favorable',
      direction_label: '偏正面（技术并购或供应链切入拓展本环节布局）',
      mechanism: `企业通过并购或新产线切入【${nodeName}】环节，增强该环节本土工艺布局与产品覆盖能力。`,
    };
  }
  return {
    direction: 'favorable',
    direction_label: '偏正面（订单扩容、业绩预增或产能放量）',
    mechanism: `【${nodeName}】环节获订单追加、业绩高增或产线放量，直接提升本环节在手订单与稼动率预期。`,
  };
}

function computeHop1Direction(
  epicenterDirection: 'favorable' | 'unfavorable' | 'uncertain',
  shock: 'selling_price' | 'input_cost' | 'demand' | 'orders' | 'supply' | 'capacity' | 'policy',
  polarity: ShockPolarity,
  isDownstream: boolean,
  edge: ChainGraphEdge,
  corpFlags: { isCapitalOnly: boolean; isSingleCompanyMna: boolean }
): {
  direction: 'favorable' | 'unfavorable' | 'uncertain';
  direction_label: string;
  shock_variable: 'selling_price' | 'input_cost' | 'demand' | 'orders' | 'supply' | 'capacity' | 'policy';
  mechanism: string;
} {
  if (corpFlags.isCapitalOnly || corpFlags.isSingleCompanyMna) {
    return {
      direction: 'uncertain',
      direction_label: '不确定（单一公司并购切入或资本运作不直接等同于全行业扩产采购，一跳传导待验证）',
      shock_variable: isDownstream ? 'supply' : 'orders',
      mechanism: `沿真实边【${edge.from_name} → ${edge.to_name} (${edge.relation})】关联：单一企业并购切入或资本运作不直接代表全行业上游设备/原料采购扩张或下游供给放量，一跳传导方向取决于后续实际资本开支与量产订单。`,
    };
  }

  if (epicenterDirection === 'uncertain' || polarity === 'ambiguous') {
    return {
      direction: 'uncertain',
      direction_label: '不确定（震中方向未定，一跳传导待观察）',
      shock_variable: isDownstream ? 'input_cost' : 'demand',
      mechanism: `沿真实边【${edge.from_name} → ${edge.to_name} (${edge.relation})】传导；因震中冲击方向尚不明确，本环节影响取决于后续实际排产与价格落地。`,
    };
  }

  if (shock === 'selling_price') {
    if (isDownstream) {
      return {
        direction: 'uncertain',
        direction_label:
          polarity === 'negative'
            ? '不确定（上游跌价降低新单采购成本，但存货跌价与下游观望并存）'
            : '偏负面（上游原材料涨价抬升本环节采购成本）',
        shock_variable: 'input_cost',
        mechanism:
          polarity === 'negative'
            ? `沿【${edge.from_name} → ${edge.to_name}】传导：上游【${edge.from_name}】价格下跌虽降低【${edge.to_name}】远期原材料成本，但短期面临高价原材料存货跌价及下游客户压价观望。`
            : `沿【${edge.from_name} → ${edge.to_name}】传导：上游【${edge.from_name}】涨价直接推升【${edge.to_name}】BOM采购成本，若顺价不畅将挤压毛利。`,
      };
    }
    return {
      direction: polarity === 'negative' ? 'unfavorable' : 'uncertain',
      direction_label: polarity === 'negative' ? '偏负面（主产品跌价向上游压价）' : '不确定（视长协锁价比例而定）',
      shock_variable: 'orders',
      mechanism: `沿【${edge.from_name} → ${edge.to_name}】逆向传导：震中价格波动影响对上游【${edge.from_name}】的采购议价与备货节奏。`,
    };
  }

  // Negative shock for orders/demand vs capacity/supply
  if (polarity === 'negative') {
    if (shock === 'orders' || shock === 'demand') {
      return {
        direction: 'unfavorable',
        direction_label: isDownstream
          ? '偏负面（终端客户削减采购反映下游系统与设备需求同步承压）'
          : '偏负面（下游砍单或需求放缓导致上游采购订单收缩）',
        shock_variable: isDownstream ? 'demand' : 'orders',
        mechanism: isDownstream
          ? `沿【${edge.from_name} → ${edge.to_name} (${edge.relation})】关联：震中【${edge.from_name}】遭遇客户削减采购，反映下游【${edge.to_name}】系统建设与装机需求同步放缓，本环节面临需求下修压力。`
          : `沿【${edge.from_name} → ${edge.to_name} (${edge.relation})】向上游传导：震中【${edge.to_name}】采购削减或需求不及预期，直接减少对上游【${edge.from_name}】的零部件与材料订单。`,
      };
    }
    return {
      direction: 'unfavorable',
      direction_label: isDownstream
        ? '偏负面（上游停产或出口管制影响本环节配套交付）'
        : '偏负面（下游停产或受限导致上游采购需求收缩）',
      shock_variable: isDownstream ? 'supply' : 'orders',
      mechanism: isDownstream
        ? `沿【${edge.from_name} → ${edge.to_name} (${edge.relation})】向下游传导：震中【${edge.from_name}】供给受阻或出口管制，制约【${edge.to_name}】配套交付与稼动率。`
        : `沿【${edge.from_name} → ${edge.to_name} (${edge.relation})】向上游传导：震中【${edge.to_name}】停产或受限，直接减少对上游【${edge.from_name}】的采购需求。`,
    };
  }

  // Positive orders / demand / capacity
  return {
    direction: isDownstream ? 'uncertain' : 'favorable',
    direction_label: isDownstream
      ? '不确定（上游扩产或订单放量需待终端装机消化验证）'
      : '偏正面（震中需求与订单扩张拉动上游采购）',
    shock_variable: isDownstream ? 'supply' : 'orders',
    mechanism: isDownstream
      ? `沿【${edge.from_name} → ${edge.to_name} (${edge.relation})】向下游传递：震中供应能力或出货提升对下游【${edge.to_name}】的实质影响取决于终端装机与配套交付进度。`
      : `沿【${edge.from_name} → ${edge.to_name} (${edge.relation})】向上游传递：震中【${edge.to_name}】订单或需求放量，拉动上游【${edge.from_name}】备货与出货。`,
  };
}

function getNodeVerifyMetric(nodeId: string): string {
  const obsList = SEED_OBSERVATIONS_BY_NODE.get(nodeId);
  if (obsList && obsList.length > 0) {
    const latest = obsList[0];
    return `${latest.source}：${latest.label}（最新值 ${latest.value}${latest.unit}，统计期 ${latest.date}）`;
  }
  return '缺：该节点暂无已接入的高频观测序列（待补充行业EDB指标与下季报分部毛利率）';
}

function classifyFactsOnlyReason(
  headline: string,
  fullText: string,
  shock: 'selling_price' | 'input_cost' | 'demand' | 'orders' | 'supply' | 'capacity' | 'policy',
  polarity: ShockPolarity,
  corpFlags: { isCapitalOnly: boolean; isSingleCompanyMna: boolean }
): string | null {
  if (isRumorDenialText(fullText)) {
    return '该事件属于传闻澄清或否认声明，生产经营一切正常，未构成实质性产业供需或价格冲击，仅保留事实不做跨环节传导。';
  }
  if (corpFlags.isCapitalOnly) {
    return '该事件属于公司股份回购、资本市场融资备案或股东层面资本运作，不直接改变当期产业供需与上下游采购订单，仅保留事实不做跨环节传导。';
  }
  if (/开盘上涨|开盘下跌|盘中涨|盘中跌|分钟涨停|连板|飘红/.test(headline)) {
    return '该资讯属于二级市场股价异动播报，未披露新增产业供需、价格或订单基本面变化，仅保留事实不做跨环节传导。';
  }
  if (polarity === 'ambiguous' && shock === 'demand') {
    return '该事件虽提及产业链相关主体或词汇，但缺乏明确的价格、订单、产能、供给或产业政策冲击方向证据，仅保留事实不做跨环节传导。';
  }
  return null;
}

function buildEventDetailFromRaw(raw: RawInputEvent): EventDetailResponse {
  const fullText = `${raw.headline} ${raw.summary || ''}`;
  const matched = matchClosedSetNode(fullText, raw.explicit_node_ids);

  if (!matched) {
    const uncoveredItem: EventSummaryItem = {
      event_id: raw.id,
      version: raw.version,
      headline: raw.headline,
      summary: raw.summary,
      published_at: raw.published_at,
      published_at_source: raw.published_at ? 'source' : 'unknown',
      observed_at: raw.observed_at,
      source_name: raw.source_name,
      source_url: raw.source_url,
      importance: 'watch',
      coverage_status: 'uncovered',
      matched_chain_id: null,
      matched_chain_name: null,
      epicenter_node_id: null,
      epicenter_node_name: null,
      one_line_impact: '未命中已建库的 3 条核心产业链节点，按闭集规则到此为止，不生成跨链推断',
      evidence_status: raw.evidence_status,
      impacted_node_count: 0,
      landed_company_count: 0,
    };

    return EventDetailResponseSchema.parse({
      event: uncoveredItem,
      claims: raw.claims,
      coverage_gap_reason:
        '该事件未命中当前已建库的 3 条核心产业链（锂电与储能、AI算力与光模块、半导体设备与材料）节点，不生成跨链传导推断。',
      impacts: [],
      subgraph_nodes: [],
      subgraph_edges: [],
      company_landings: [],
      missing_evidence: ['不在当前已建模的 3 条产业链节点范围内'],
    });
  }

  const chain = CORE_CHAIN_SUMMARIES.find(c => c.id === matched.chainId)!;
  const epicenter = ALL_GRAPH_NODES[matched.nodeId]!;
  const corpFlags = isCapitalOrSingleCorpActionText(fullText);

  const factsOnlyReason = classifyFactsOnlyReason(
    raw.headline,
    fullText,
    matched.shock,
    matched.polarity,
    corpFlags
  );
  if (factsOnlyReason) {
    const factsOnlyItem: EventSummaryItem = {
      event_id: raw.id,
      version: raw.version,
      headline: raw.headline,
      summary: raw.summary,
      published_at: raw.published_at,
      published_at_source: raw.published_at ? 'source' : 'unknown',
      observed_at: raw.observed_at,
      source_name: raw.source_name,
      source_url: raw.source_url,
      importance: 'watch',
      coverage_status: 'facts_only',
      matched_chain_id: chain.id,
      matched_chain_name: chain.name,
      epicenter_node_id: epicenter.id,
      epicenter_node_name: epicenter.name,
      one_line_impact: `涉及节点【${epicenter.name}】，但${factsOnlyReason.replace(/^该(事件|资讯)/, '')}`,
      evidence_status: raw.evidence_status,
      impacted_node_count: 0,
      landed_company_count: 0,
    };

    return EventDetailResponseSchema.parse({
      event: factsOnlyItem,
      claims: raw.claims,
      coverage_gap_reason: factsOnlyReason,
      impacts: [],
      subgraph_nodes: [],
      subgraph_edges: [],
      company_landings: [],
      missing_evidence: [],
    });
  }

  const primaryClaimId = raw.claims[0]?.claim_id ?? 'claim_1';

  const impacts: EventNodeImpact[] = [];
  const visitedNodes = new Set<string>([epicenter.id]);

  const epEval = computeEpicenterDirection(matched.shock, matched.polarity, epicenter.name, corpFlags);

  impacts.push({
    impact_id: `imp_0_${epicenter.id}`,
    node_id: epicenter.id,
    node_name: epicenter.name,
    hop: 0,
    via_edge_id: null,
    via_edge_relation: null,
    from_node_id: null,
    from_node_name: null,
    direction: epEval.direction,
    direction_label: epEval.direction_label,
    shock_variable: matched.shock,
    mechanism: epEval.mechanism,
    conditions: ['事件所述变化在当期排产、价格或公告合同中实际执行'],
    counterforces: ['存量长协锁价缓冲', '同业竞争格局与库存周期反向抵消'],
    verify_metric: getNodeVerifyMetric(epicenter.id),
    depends_on_claim_ids: [primaryClaimId],
  });

  // Hop 1: traverse connected edges within the same chain
  const chainNodeIds = CHAIN_NODE_MEMBERSHIP[matched.chainId] || [];
  const hop1Edges = ALL_GRAPH_EDGES.filter(
    e =>
      (e.from_id === epicenter.id || e.to_id === epicenter.id) &&
      chainNodeIds.includes(e.from_id) &&
      chainNodeIds.includes(e.to_id)
  );

  const hop1Nodes: string[] = [];
  for (const edge of hop1Edges) {
    const isDownstream = edge.from_id === epicenter.id;
    const neighborId = isDownstream ? edge.to_id : edge.from_id;
    if (visitedNodes.has(neighborId)) continue;
    const neighbor = ALL_GRAPH_NODES[neighborId];
    if (!neighbor) continue;

    visitedNodes.add(neighborId);
    hop1Nodes.push(neighborId);

    const h1Eval = computeHop1Direction(
      epEval.direction,
      matched.shock,
      matched.polarity,
      isDownstream,
      edge,
      corpFlags
    );

    impacts.push({
      impact_id: `imp_1_${neighbor.id}`,
      node_id: neighbor.id,
      node_name: neighbor.name,
      hop: 1,
      via_edge_id: edge.id,
      via_edge_relation: edge.relation,
      from_node_id: edge.from_id,
      from_node_name: edge.from_name,
      direction: h1Eval.direction,
      direction_label: h1Eval.direction_label,
      shock_variable: h1Eval.shock_variable,
      mechanism: h1Eval.mechanism,
      conditions: ['上下游采购价格或订单传导无长协阻滞', '中间环节库存处于常态水平'],
      counterforces: ['长协锁价或备货库存消化期缓冲', '多供应商份额切换'],
      verify_metric: getNodeVerifyMetric(neighbor.id),
      depends_on_claim_ids: [primaryClaimId],
    });
  }

  // Hop 2: traverse 1 additional step from hop1Nodes within the same chain
  for (const h1Id of hop1Nodes) {
    const hop2Edges = ALL_GRAPH_EDGES.filter(
      e =>
        (e.from_id === h1Id || e.to_id === h1Id) &&
        chainNodeIds.includes(e.from_id) &&
        chainNodeIds.includes(e.to_id)
    );
    for (const edge of hop2Edges) {
      const isDownstream = edge.from_id === h1Id;
      const neighborId = isDownstream ? edge.to_id : edge.from_id;
      if (visitedNodes.has(neighborId)) continue;
      const neighbor = ALL_GRAPH_NODES[neighborId];
      if (!neighbor) continue;

      visitedNodes.add(neighborId);
      impacts.push({
        impact_id: `imp_2_${neighbor.id}`,
        node_id: neighbor.id,
        node_name: neighbor.name,
        hop: 2,
        via_edge_id: edge.id,
        via_edge_relation: edge.relation,
        from_node_id: edge.from_id,
        from_node_name: edge.from_name,
        direction: 'uncertain',
        direction_label: '不确定（二跳远端传导，存在跨期时滞与衰减）',
        shock_variable: isDownstream ? 'demand' : 'orders',
        mechanism: `二跳沿【${edge.from_name} → ${edge.to_name} (${edge.relation})】扩散；需待一跳环节排产与价格实际兑现后方能验证。`,
        conditions: ['一跳环节库存消化完毕', '终端需求或供给变化持续超过一个季度'],
        counterforces: ['二跳传导链条边际衰减'],
        verify_metric: getNodeVerifyMetric(neighbor.id),
        depends_on_claim_ids: [primaryClaimId],
      });
    }
  }

  // Land ONLY on companies with verified business exposure on impacted nodes
  const impactedNodeIds = impacts.map(i => i.node_id);
  const landedExposures = ALL_COMPANY_EXPOSURES.filter(
    e => impactedNodeIds.includes(e.node_id) && e.strength !== 'candidate_only'
  );

  const landings: EventCompanyLanding[] = landedExposures.map(exp => {
    const imp = impacts.find(i => i.node_id === exp.node_id)!;
    const sharePct = exp.revenue_share !== null ? `${(exp.revenue_share * 100).toFixed(2)}%` : '未拆分占比';
    const gmPct =
      exp.product_gross_margin !== null ? `，分项毛利率 ${(exp.product_gross_margin * 100).toFixed(2)}%` : '';
    return {
      company_code: exp.company_code,
      company_name: exp.company_name,
      node_id: exp.node_id,
      node_name: exp.node_name,
      hop: imp.hop,
      node_direction: imp.direction,
      exposure_strength: exp.strength,
      revenue_share: exp.revenue_share,
      product_gross_margin: exp.product_gross_margin,
      exposure_basis: exp.basis_text,
      conditional_note: `公司在节点【${exp.node_name}】具备明确主营暴露（产品：${exp.matched_product_name ?? exp.role}，营收占比 ${sharePct}${gmPct}）；产业关系不等于具体供货合同，实际影响取决于公司订单与成本传导。`,
      evidence: exp.evidence,
    };
  });

  const subNodes = impactedNodeIds
    .map(id => {
      const rawNode = ALL_GRAPH_NODES[id];
      if (!rawNode) return null;
      const ms = calculateNodeGrossMarginStats(id);
      return { ...rawNode, computed_median_margin: ms.median_gross_margin };
    })
    .filter((n): n is NonNullable<typeof n> => Boolean(n));

  const subEdges = ALL_GRAPH_EDGES.filter(
    e => impactedNodeIds.includes(e.from_id) && impactedNodeIds.includes(e.to_id)
  );

  const summaryItem: EventSummaryItem = {
    event_id: raw.id,
    version: raw.version,
    headline: raw.headline,
    summary: raw.summary,
    published_at: raw.published_at,
    published_at_source: raw.published_at ? 'source' : 'unknown',
    observed_at: raw.observed_at,
    source_name: raw.source_name,
    source_url: raw.source_url,
    importance: raw.evidence_status === 'primary_supported' ? 'major' : 'watch',
    coverage_status: 'mapped',
    matched_chain_id: chain.id,
    matched_chain_name: chain.name,
    epicenter_node_id: epicenter.id,
    epicenter_node_name: epicenter.name,
    one_line_impact: `定位震中节点【${epicenter.name}】（0跳，${epEval.direction_label}），沿有向边推导至 ${impacts.length} 个节点，关联 ${landings.length} 项主营暴露记录。`,
    evidence_status: raw.evidence_status,
    impacted_node_count: impacts.length,
    landed_company_count: landings.length,
  };

  return EventDetailResponseSchema.parse({
    event: summaryItem,
    claims: raw.claims,
    coverage_gap_reason: null,
    impacts,
    subgraph_nodes: subNodes,
    subgraph_edges: subEdges,
    company_landings: landings,
    missing_evidence: raw.published_at ? [] : ['来源未提供明确发布时间，仅记录采集观察时间，不作发生时点断言'],
  });
}

export async function listEvents(pool?: Pool): Promise<EventListResponse> {
  const systemStatus = await getSystemStatus(pool);
  const rawEvents = await loadRawEventsFromDb(pool);
  const items: EventSummaryItem[] = rawEvents.map(raw => buildEventDetailFromRaw(raw).event);

  return EventListResponseSchema.parse({
    items,
    total: items.length,
    system_status: systemStatus,
  });
}

export async function getEventDetail(eventId: string, pool?: Pool): Promise<EventDetailResponse> {
  const custom = IN_MEMORY_CUSTOM_EVENTS.get(eventId);
  if (custom) {
    return buildEventDetailFromRaw(custom);
  }
  const rawEvents = await loadRawEventsFromDb(pool);
  const found = rawEvents.find(e => e.id === eventId);
  if (found) {
    return buildEventDetailFromRaw(found);
  }
  throw new ApiError(404, 'NOT_FOUND', `未找到事件 ID: ${eventId}`);
}

export async function evaluateTextEvent(text: string): Promise<EventDetailResponse> {
  const cleanText = text.trim();
  const hashId = 'ev_' + createHash('sha256').update(cleanText).digest('hex').slice(0, 12);
  const nowIso = new Date().toISOString();
  const raw: RawInputEvent = {
    id: hashId,
    version: 1,
    headline: cleanText.slice(0, 80),
    summary: cleanText,
    published_at: null,
    observed_at: nowIso,
    source_name: '待核验输入文本',
    source_url: null,
    evidence_status: 'unverified',
    explicit_node_ids: [],
    claims: [
      {
        claim_id: `clm_${hashId}`,
        text: cleanText,
        kind: 'source_opinion',
        evidence_status: 'unverified',
        evidence: [],
      },
    ],
  };

  IN_MEMORY_CUSTOM_EVENTS.set(hashId, raw);
  return buildEventDetailFromRaw(raw);
}

export async function getCompanyRecentNodeEvents(
  companyCode: string,
  pool?: Pool
): Promise<CompanyProfileResponse['recent_node_events']> {
  const normCode = companyCode.toUpperCase();
  const rawEvents = await loadRawEventsFromDb(pool);
  const results: CompanyProfileResponse['recent_node_events'] = [];

  for (const raw of rawEvents) {
    const detail = buildEventDetailFromRaw(raw);
    for (const landing of detail.company_landings) {
      if (landing.company_code.toUpperCase() === normCode) {
        const nodeImpact = detail.impacts.find(imp => imp.node_id === landing.node_id);
        results.push({
          event_id: detail.event.event_id,
          headline: detail.event.headline,
          published_at: detail.event.published_at,
          node_id: landing.node_id,
          node_name: landing.node_name,
          hop: landing.hop,
          direction: landing.node_direction,
          mechanism: nodeImpact?.mechanism ?? landing.conditional_note,
          exposure_strength: landing.exposure_strength,
          revenue_share: landing.revenue_share,
        });
      }
    }
    if (results.length >= 10) break;
  }

  return results;
}
