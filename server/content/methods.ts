import type { Company, Evidence, Exposure, IndustryEdge, Mechanism, MethodSet, News } from '../../src/content/types.js';
import { hash } from '../db.js';
// Versioned data, not title/keyword rules. New semantics require a new version.
export const METHODS: MethodSet = {
  version: 'content-conditional/1.1.1', status: 'conditional_only',
  disclaimer: '仅解释有出处的事实、产业结构与条件路径；不判断股价、目标价或买卖。产业关系不代表公司供货合同。没有已核实显式变化时，以下仅为适用框架：待核实触发条件，不是当前事实。',
  methods: [
    { id: 'cost-price', variables: ['input_cost','selling_price'], title: '成本与售价的角色分离',
      conditions: ['核实变化的品级、期间、口径与适用产业', '成本变化作用于使用方；原料销售方仅在自身售价同步变化时受影响', '售价变化不等于利润变化，需销量、成本及合同传导依据'],
      reverse_factors: ['长协定价或套期保值', '成本转嫁、产品结构、汇率变化', '销量下降抵消单价变化'],
      required_data: ['采购/销售价格与期间', '原材料成本占比', '销量、合同及套保安排', '有出处的主营与分部财务'],
      explanation: '沿有证据的供应侧→使用侧关系区分销售方和使用方，不将价格变化直接翻译为受益或受损。',
      direct_explanations: {
        input_cost: '使用侧实际投入成本若按此方向变化，单位成本可能同向变化；利润还取决于成本占比、转嫁、销量和套保。不能据此认定上游售价变化。',
        selling_price: '销售侧实际售价若变化，单位收入可能同向变化；收入和利润仍取决于销量、成本与合同，不等同于股价方向。'
      }, transmissions: [
        { variables: ['input_cost'], anchor: 'to', edge_kinds: ['input','output','equipment','service'], statement: '该节点为投入品供应侧；仅若其销售品种与本次投入成本口径相同、实际售价同步变化，才可能改变单位收入，不能由使用方成本直接推定供应方利润。' },
        { variables: ['selling_price'], anchor: 'from', edge_kinds: ['input','output','equipment','service'], statement: '该节点为使用侧；仅当其实际采购此产品且合同价格传导时，才可能改变投入成本；需核实成本占比和转嫁能力。' }
      ] }, 
    { id: 'demand-orders', variables: ['demand','orders'], title: '需求/订单的有条件传递',
      conditions: ['订单或需求变化有明确对象和期间', '仅通过明确供应关系向上游考察采购传导', '采购传递需要库存、开工率及采购合同支持'],
      reverse_factors: ['去库存消化订单', '进口替代或供应商份额变化', '产能约束或订单取消'],
      required_data: ['订单量与履约期间', '产销及库存', '采购结构及供应关系'],
      explanation: '相关公司不自动获得订单；供应商分类/上下游不证明具体供货。',
      direct_explanations: { demand: '需求若真实兑现且产能可满足，才可能改变业务量；需实际生产与采购依据。', orders: '订单若真实兑现且产能可满足，才可能改变业务量；订单不等于收入，需履约与确认依据。' },
      transmissions: [{ variables: ['demand','orders'], anchor: 'to', edge_kinds: ['input','output','equipment','service'], statement: '若需求/订单变化转化为实际生产与采购，并由此供应环节承接，才可能传导为采购量变化；无具体供货或份额结论。' }] }, 
    { id: 'supply-capacity', variables: ['supply','capacity'], title: '供给与有效产能',
      conditions: ['区分名义产能与实际产量', '供给变化对价格的作用取决于同期需求与替代来源'],
      reverse_factors: ['投产爬坡或停产检修', '进口、替代品和库存缓冲'],
      required_data: ['产能利用率及投产时点', '实际产量、需求和库存', '价格及替代来源'],
      explanation: '扩产不等于增收，减产不等于涨价，仅列约束和传导条件。',
      direct_explanations: { supply: '供给若转化为有效可交付产量，才可能改变供需约束；价格与收入方向需同期需求、库存及替代供给依据。', capacity: '名义产能若转化为有效可交付产量，才可能改变供需约束；价格与收入方向需同期需求、库存及替代供给依据。' },
      transmissions: [{ variables: ['supply','capacity'], anchor: 'from', edge_kinds: ['input','output','equipment','service'], statement: '仅在实际可交付供给变化、替代供给和库存无法抵消时，使用侧可得性或采购条件才可能变化；不据此推断价格方向。' }] }, 
    { id: 'inventory', variables: ['inventory'], title: '库存的非唯一解释',
      conditions: ['仅在同品级、单位、频率与统计范围下比较', '库存变化本身不证明需求变化'],
      reverse_factors: ['主动备库', '季节性与物流延迟', '供给收缩或统计范围变化'],
      required_data: ['库存口径与历史序列', '同期产销、进出口与库存周转'],
      explanation: '库存单独变化不推断需求或价格方向。',
      direct_explanations: { inventory: '库存仅是本口径下的存量变化；可能来自供给、需求或备库，不据此推断需求或价格方向。' }, transmissions: [] }, 
    { id: 'policy', variables: ['policy'], title: '政策适用对象与执行条件',
      conditions: ['核实政策原文、生效时间、地域与适用对象', '仅列明确受约束产业及待核实的执行条件'],
      reverse_factors: ['配套细则或豁免', '执行节奏与区域差异', '既有合同及替代行为'],
      required_data: ['政策原文与生效日期', '适用对象、豁免和执行细则', '公司业务与合规披露'],
      explanation: '政策“变化”不自动赋予正负方向或跨产业收益。',
      direct_explanations: { policy: '仅识别该政策明确约束对象；适用范围、生效和执行细则核实前，不推断经营正负影响。' }, transmissions: [] }
  ]
};
const variableLabels = { input_cost: '投入成本', selling_price: '销售价格', demand: '需求', capacity: '产能', supply: '供给', inventory: '库存', policy: '政策', orders: '订单' };
const directionLabels = { up: '上升', down: '下降', changed: '变化' };
export const hasVerifiedEvidence = (items: Evidence[]) => items.some(e => e.verification !== 'unverified' && Boolean(e.provider.trim() && e.title.trim() && (e.url || e.source_item_id)));
export const verifiedChange = (news: News) => Boolean(news.change && news.verification !== 'unverified' && news.change.basis.trim() && hasVerifiedEvidence(news.change.evidence));
export interface MechanismContext { edges: IndustryEdge[]; exposures: Exposure[]; companies: Company[] }
export function missingForNews(news: News): string[] {
  const missing: string[] = [];
  if (!news.published_at) missing.push('新闻发布时间未知；采集时间不作为发生时间或今日新闻依据');
  if (!news.change) missing.push('待核实触发条件：缺少显式变量变化，标题与实体相关不构成变化证据');
  else if (!verifiedChange(news)) missing.push('待核实触发条件：变化或新闻未经核实，或缺少可追溯依据');
  if (!news.node_ids.length && !news.company_codes.length) missing.push('缺少已核实的产业/公司关联');
  return missing;
}
export function explainNews(news: News, context: MechanismContext): Mechanism[] {
  if (!verifiedChange(news) || !news.change) return [];
  const change = news.change;
  const method = METHODS.methods.find(m => m.variables.includes(change.variable))!;
  type Target = { node: string; edge?: IndustryEdge; statement: string };
  const targets: Target[] = [{ node: change.node_id, statement: method.direct_explanations[change.variable] ?? method.explanation }];
  // Generic interpreter: variables, roles, allowed edge kinds and statements live in versioned data.
  for (const rule of method.transmissions) {
    if (!rule.variables.includes(change.variable)) continue;
    for (const edge of context.edges) {
      if (edge.kind === 'classification' || !rule.edge_kinds.includes(edge.kind) || !hasVerifiedEvidence(edge.evidence)) continue;
      const anchor = rule.anchor === 'from' ? edge.from_id : edge.to_id;
      if (anchor !== change.node_id) continue;
      targets.push({ node: rule.anchor === 'from' ? edge.to_id : edge.from_id, edge, statement: rule.statement });
    }
  }
  const companies = new Map(context.companies.map(c => [c.code, c]));
  const mechanisms: Mechanism[] = [];
  for (const target of targets) {
    const base: Mechanism = {
      id: `mechanism:${hash(JSON.stringify([METHODS.version, news.id, target.node, target.edge?.id ?? null, null]))}`, 
      method_version: METHODS.version, method_id: method.id, status: 'conditional', news_id: news.id, node_id: target.node,
      company_code: null, variable: change.variable, direction: change.direction,
      steps: [
        { kind: 'fact', statement: `${variableLabels[change.variable]}${directionLabels[change.direction]}：${change.basis}`, evidence: change.evidence },
        ...(target.edge ? [{ kind: 'structure' as const, statement: `${target.edge.from_id} → ${target.edge.to_id}（${target.edge.kind}），仅产业结构，非公司合同`, evidence: target.edge.evidence, edge_id: target.edge.id }] : []),
        { kind: 'inference', statement: target.statement, evidence: [] }
      ], conditions: [...method.conditions], reverse_factors: [...method.reverse_factors], missing_evidence: [...method.required_data]
    };
    mechanisms.push(base);
    for (const exposure of context.exposures) {
      if (exposure.node_id !== target.node || exposure.status !== 'business' || !exposure.basis.trim() || !hasVerifiedEvidence(exposure.evidence)) continue;
      const company = companies.get(exposure.company_code);
      if (!company || !company.business.trim() || !hasVerifiedEvidence(company.evidence)) continue;
      const financials = company.financials.filter(f => hasVerifiedEvidence(f.evidence));
      mechanisms.push({ ...base, id: `mechanism:${hash(JSON.stringify([METHODS.version, news.id, target.node, target.edge?.id ?? null, exposure.id]))}`,  company_code: company.code,
        steps: [...base.steps.slice(0, -1),
          { kind: 'structure', statement: `${company.name}主营：${company.business}；角色：${exposure.role}；匹配依据：${exposure.basis}。不代表具体供货合同。`, evidence: [...company.evidence, ...exposure.evidence], exposure_id: exposure.id },
          // Company-wide financials need a scoped causal link before entering a mechanism.
          // The full financial record remains available on the company page.
          base.steps[base.steps.length - 1]],
        conditions: [...base.conditions, '公司主营暴露与本次变化口径一致；具体交易与传导尚需证据'],
        missing_evidence: [...base.missing_evidence, ...(!financials.length ? ['缺少有出处的公司财务项，不合成利润或敏感度'] : []), ...(!company.report_period ? ['公司报告期未知'] : [])]
      });
    }
  }
  return mechanisms;
}
